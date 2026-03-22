/**
 * s09 — JSONL 邮箱 + 持久队友：.team/config.json 与 .team/inbox/*.jsonl
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const VALID_MSG_TYPES = [
  "message",
  "broadcast",
  "shutdown_request",
  "shutdown_response",
  "plan_approval_response",
];

const VALID_SET = new Set(VALID_MSG_TYPES);

export class MessageBus {
  constructor(inboxDir) {
    this.dir = inboxDir;
    mkdirSync(this.dir, { recursive: true });
  }

  send(sender, to, content, msgType = "message", extra = null) {
    if (!VALID_SET.has(msgType)) {
      return `Error: Invalid type '${msgType}'. Valid: ${VALID_MSG_TYPES.join(", ")}`;
    }
    const msg = {
      type: msgType,
      from: sender,
      content,
      timestamp: Date.now() / 1000,
    };
    if (extra && typeof extra === "object") Object.assign(msg, extra);
    const inboxPath = join(this.dir, `${to}.jsonl`);
    writeFileSync(inboxPath, `${JSON.stringify(msg)}\n`, { flag: "a" });
    return `Sent ${msgType} to ${to}`;
  }

  readInbox(name) {
    const inboxPath = join(this.dir, `${name}.jsonl`);
    try {
      const raw = readFileSync(inboxPath, "utf8").trim();
      if (!raw) return [];
      const messages = raw
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      writeFileSync(inboxPath, "", "utf8");
      return messages;
    } catch {
      return [];
    }
  }

  broadcast(sender, content, teammates) {
    let count = 0;
    for (const name of teammates) {
      if (name !== sender) {
        this.send(sender, name, content, "broadcast");
        count += 1;
      }
    }
    return `Broadcast to ${count} teammates`;
  }
}

/**
 * @param {object} deps
 * @param {string} deps.teamDir - .team 目录（写入 config.json）
 * @param {MessageBus} deps.bus
 */
export function createTeammateManager({ teamDir, bus, client, model, repoRoot, fsHandlers }) {
  mkdirSync(teamDir, { recursive: true });
  const configPath = join(teamDir, "config.json");

  function loadConfig() {
    try {
      return JSON.parse(readFileSync(configPath, "utf8"));
    } catch {
      return { team_name: "default", members: [] };
    }
  }

  function saveConfig(cfg) {
    writeFileSync(configPath, JSON.stringify(cfg, null, 2), "utf8");
  }

  const teammateTools = [
    {
      name: "bash",
      description: "Run a shell command.",
      input_schema: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
    },
    {
      name: "read_file",
      description: "Read file contents.",
      input_schema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
    {
      name: "write_file",
      description: "Write content to file.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "edit_file",
      description: "Replace exact text in file.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_text: { type: "string" },
          new_text: { type: "string" },
        },
        required: ["path", "old_text", "new_text"],
      },
    },
    {
      name: "send_message",
      description: "Send message to a teammate.",
      input_schema: {
        type: "object",
        properties: {
          to: { type: "string" },
          content: { type: "string" },
          msg_type: { type: "string", enum: [...VALID_MSG_TYPES] },
        },
        required: ["to", "content"],
      },
    },
    {
      name: "read_inbox",
      description: "Read and drain your inbox.",
      input_schema: { type: "object", properties: {} },
    },
  ];

  async function execTeammateTool(sender, toolName, input) {
    const a = input ?? {};
    if (toolName === "bash") return fsHandlers.runBash(a.command);
    if (toolName === "read_file") return fsHandlers.runRead(a.path);
    if (toolName === "write_file") {
      return fsHandlers.runWrite(a.path, a.content);
    }
    if (toolName === "edit_file") {
      return fsHandlers.runEdit(a.path, a.old_text, a.new_text);
    }
    if (toolName === "send_message") {
      return bus.send(sender, a.to, a.content, a.msg_type ?? "message");
    }
    if (toolName === "read_inbox") {
      return JSON.stringify(bus.readInbox(sender), null, 2);
    }
    return `Unknown tool: ${toolName}`;
  }

  async function teammateLoop(name, role, prompt) {
    const sysPrompt =
      `You are '${name}', role: ${role}, at ${repoRoot}. ` +
      `Use send_message to communicate. Complete your task.`;
    const messages = [{ role: "user", content: prompt }];
    let response;

    for (let turn = 0; turn < 50; turn++) {
      const inbox = bus.readInbox(name);
      for (const msg of inbox) {
        messages.push({ role: "user", content: JSON.stringify(msg) });
      }
      try {
        response = await client.messages.create({
          model,
          system: sysPrompt,
          messages,
          tools: teammateTools,
          max_tokens: 8000,
        });
      } catch {
        break;
      }
      messages.push({ role: "assistant", content: response.content });
      if (response.stop_reason !== "tool_use") break;

      const results = [];
      for (const block of response.content) {
        if (block.type === "tool_use") {
          const output = await execTeammateTool(name, block.name, block.input);
          console.log(`  [${name}] ${block.name}: ${String(output).slice(0, 120)}`);
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: String(output),
          });
        }
      }
      messages.push({ role: "user", content: results });
    }

    const cfg = loadConfig();
    const m = cfg.members.find((x) => x.name === name);
    if (m && m.status !== "shutdown") {
      m.status = "idle";
      saveConfig(cfg);
    }
  }

  return {
    spawn(name, role, prompt) {
      const cfg = loadConfig();
      let member = cfg.members.find((x) => x.name === name);
      if (member) {
        if (!["idle", "shutdown"].includes(member.status)) {
          return `Error: '${name}' is currently ${member.status}`;
        }
        member.status = "working";
        member.role = role;
      } else {
        cfg.members.push({ name, role, status: "working" });
      }
      saveConfig(cfg);

      void teammateLoop(name, role, prompt).catch((e) => {
        console.error(`[teammate ${name}]`, e);
        const c = loadConfig();
        const mem = c.members.find((x) => x.name === name);
        if (mem && mem.status !== "shutdown") {
          mem.status = "idle";
          saveConfig(c);
        }
      });

      return `Spawned '${name}' (role: ${role})`;
    },

    listAll() {
      const cfg = loadConfig();
      if (!cfg.members.length) return "No teammates.";
      const lines = [`Team: ${cfg.team_name}`];
      for (const m of cfg.members) {
        lines.push(`  ${m.name} (${m.role}): ${m.status}`);
      }
      return lines.join("\n");
    },

    memberNames() {
      return loadConfig().members.map((m) => m.name);
    },
  };
}
