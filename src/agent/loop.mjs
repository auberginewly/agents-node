/**
 * Agent 主循环：请求模型、执行工具、写回 tool_result；可选 minimal 仅 bash。
 */
import { join } from "node:path";
import { formatToolLogPreview, formatBashLog } from "../ui/terminal-fmt.mjs";
import { TodoManager } from "../tasks/todo-manager.mjs";
import { TaskManager } from "../tasks/task-manager.mjs";
import { SkillLoader } from "../skills/skill-loader.mjs";
import { BackgroundManager } from "../tasks/background-manager.mjs";
import { MessageBus, createTeammateManager } from "../team/team.mjs";
import {
  estimateTokens,
  microCompact,
  autoCompact,
  TOKEN_THRESHOLD,
} from "./context-compact.mjs";
import { createFilesystemTools } from "../tools/tools.mjs";
import { createRunSubagent } from "./subagent.mjs";
import {
  CHILD_TOOLS,
  PARENT_TOOLS_FULL,
  SCHEMA_BASH,
} from "../tools/tool-schemas.mjs";

const TRANSCRIPT_DIR_NAME = ".transcripts";

export function buildSystemPrompt({ repoRoot, skillLoader, minimal }) {
  if (minimal) {
    return `You are a coding agent at ${repoRoot}. Use bash to solve tasks. Act, don't explain.`;
  }
  return `You are a coding agent and team lead at ${repoRoot}.

Planning: use the todo tool for in-session steps; use task_create / task_update / task_list / task_get for persistent tasks under .tasks/ (survives context compression).

Knowledge: use load_skill when needed.

Delegation: use task for one-off subagents (fresh context). Use spawn_teammate for persistent teammates; use send_message, read_inbox, broadcast, list_teammates for the team mailbox (.team/inbox/).

Execution: use background_run for long shell commands; completions are injected as <background-results> before your next model turn when applicable.

Context: use compact when appropriate; old tool output may be micro-compacted automatically.

Prefer tools over prose.

Skills available:
${skillLoader.getDescriptions()}`;
}

export function createAgentRuntime({ client, model, repoRoot, minimal }) {
  const fsApi = createFilesystemTools(repoRoot);
  const skillLoader = new SkillLoader(join(repoRoot, "skills"));
  const todo = new TodoManager();

  const taskManager = minimal
    ? null
    : new TaskManager(join(repoRoot, ".tasks"));
  const backgroundManager = minimal ? null : new BackgroundManager(repoRoot);

  const teamDir = join(repoRoot, ".team");
  const inboxDir = join(teamDir, "inbox");
  const teamBus = minimal ? null : new MessageBus(inboxDir);
  const teammateManager = minimal
    ? null
    : createTeammateManager({
        teamDir,
        bus: teamBus,
        client,
        model,
        repoRoot,
        fsHandlers: {
          runBash: (c) => fsApi.runBash(c),
          runRead: (p) => fsApi.runRead(p),
          runWrite: (p, c) => fsApi.runWrite(p, c),
          runEdit: (p, o, n) => fsApi.runEdit(p, o, n),
        },
      });

  const baseHandlers = {
    bash: async (input) => fsApi.runBash(input.command),
    read_file: async (input) => fsApi.runRead(input.path, input.limit),
    write_file: async (input) => fsApi.runWrite(input.path, input.content),
    edit_file: async (input) =>
      fsApi.runEdit(input.path, input.old_text, input.new_text),
  };

  const subagentSystem = `You are a coding subagent at ${repoRoot}. Complete the given task, then summarize your findings.`;

  const runSubagent = minimal
    ? async () => "(task tool disabled in minimal mode)"
    : createRunSubagent({
        client,
        model,
        subagentSystem,
        childTools: CHILD_TOOLS,
        baseHandlers,
        maxTurns: 30,
      });

  const parentHandlers = minimal
    ? { bash: baseHandlers.bash }
    : {
        ...baseHandlers,
        todo: async (input) => todo.update(input.items),
        task: async (input) => runSubagent(input.prompt),
        load_skill: async (input) => skillLoader.getContent(input.name),
        compact: async () => "Manual compression requested.",
        task_create: async (input) =>
          taskManager.create(input.subject, input.description ?? ""),
        task_update: async (input) =>
          taskManager.update(
            input.task_id,
            input.status,
            input.addBlockedBy ?? input.add_blocked_by,
            input.addBlocks ?? input.add_blocks,
          ),
        task_list: async () => taskManager.listAll(),
        task_get: async (input) => taskManager.get(input.task_id),
        background_run: async (input) => backgroundManager.run(input.command),
        check_background: async (input) =>
          backgroundManager.check(input.task_id),
        spawn_teammate: async (input) =>
          teammateManager.spawn(input.name, input.role, input.prompt),
        list_teammates: async () => teammateManager.listAll(),
        send_message: async (input) =>
          teamBus.send(
            "lead",
            input.to,
            input.content,
            input.msg_type ?? "message",
          ),
        read_inbox: async () =>
          JSON.stringify(teamBus.readInbox("lead"), null, 2),
        broadcast: async (input) =>
          teamBus.broadcast(
            "lead",
            input.content,
            teammateManager.memberNames(),
          ),
      };

  const tools = minimal ? [SCHEMA_BASH] : PARENT_TOOLS_FULL;
  const system = buildSystemPrompt({ repoRoot, skillLoader, minimal });
  const transcriptDir = join(repoRoot, TRANSCRIPT_DIR_NAME);

  /** 将块追加到最后一条 user，避免在「工具结果的 user」后再插一条 user（部分网关会报 tool 未配对）。 */
  function appendBlocksToLastUser(messages, blocks) {
    if (!blocks.length || !messages.length) return false;
    const last = messages[messages.length - 1];
    if (last.role !== "user") return false;
    if (typeof last.content === "string") {
      last.content = [{ type: "text", text: last.content }];
    } else if (!Array.isArray(last.content)) {
      last.content = [{ type: "text", text: String(last.content ?? "") }];
    }
    last.content.push(...blocks);
    return true;
  }

  /** s08 / s09：在每次请求模型前注入后台完成通知与 lead 邮箱（合并进最后一条 user，避免连续两条 user） */
  function injectPreLlmHooks(messages) {
    if (minimal) return;
    const extra = [];
    const bgNotifs = backgroundManager.drainNotifications();
    if (bgNotifs.length) {
      const notifText = bgNotifs
        .map((n) => `[bg:${n.task_id}] ${n.status}: ${n.result}`)
        .join("\n");
      extra.push({
        type: "text",
        text: `<background-results>\n${notifText}\n</background-results>`,
      });
    }
    const inbox = teamBus.readInbox("lead");
    if (inbox.length) {
      extra.push({
        type: "text",
        text: `<inbox>${JSON.stringify(inbox, null, 2)}</inbox>`,
      });
    }
    if (!extra.length) return;
    if (!appendBlocksToLastUser(messages, extra)) {
      messages.push({ role: "user", content: extra });
      messages.push({
        role: "assistant",
        content: "Noted background/inbox updates.",
      });
    }
  }

  async function agentLoop(messages) {
    let roundsSinceTodo = 0;

    while (true) {
      if (!minimal) {
        microCompact(messages);
        if (estimateTokens(messages) > TOKEN_THRESHOLD) {
          console.log("[auto_compact triggered]");
          const replacement = await autoCompact(
            client,
            model,
            messages,
            transcriptDir,
          );
          messages.length = 0;
          messages.push(...replacement);
        }
        injectPreLlmHooks(messages);
      }

      const response = await client.messages.create({
        model,
        system,
        messages,
        tools,
        max_tokens: 8000,
      });

      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason !== "tool_use") {
        return;
      }

      const toolUses = response.content.filter((b) => b?.type === "tool_use");
      const userContent = [];
      let usedTodo = false;
      let manualCompact = false;

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

        let output;
        if (block.name === "task") {
          const desc = block.input?.description ?? "subtask";
          console.log(
            `> task (${desc}): ${String(block.input?.prompt ?? "").slice(0, 80)}`,
          );
          output = await parentHandlers.task(block.input ?? {});
        } else if (block.name === "compact") {
          manualCompact = true;
          output = "Compressing...";
        } else {
          const handler = parentHandlers[block.name];
          try {
            output = handler
              ? await handler(block.input ?? {})
              : `Unknown tool: ${block.name}`;
          } catch (e) {
            output = `Error: ${e.message ?? e}`;
          }
        }

        if (block.name === "todo") usedTodo = true;

        if (minimal && block.name === "bash") {
          const cmd = block.input?.command ?? "";
          console.log(formatBashLog(cmd, output));
        } else {
          console.log(
            formatToolLogPreview(block.name, output, {
              toolInput: block.input ?? {},
              repoRoot,
            }),
          );
        }

        userContent.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: String(output),
        });
      }

      const seenIds = new Set(
        userContent.map((b) => b.tool_use_id).filter(Boolean),
      );
      for (const block of toolUses) {
        if (block.id && !seenIds.has(block.id)) {
          userContent.push({
            type: "tool_result",
            tool_use_id: block.id,
            content:
              "Error: Internal — no tool result was recorded for this tool_use id.",
          });
          seenIds.add(block.id);
        }
      }

      roundsSinceTodo = usedTodo ? 0 : roundsSinceTodo + 1;
      if (!minimal && roundsSinceTodo >= 3) {
        userContent.push({
          type: "text",
          text: "<reminder>Update your todos.</reminder>",
        });
      }

      messages.push({ role: "user", content: userContent });

      if (!minimal && manualCompact) {
        console.log("[manual compact]");
        const replacement = await autoCompact(
          client,
          model,
          messages,
          transcriptDir,
        );
        messages.length = 0;
        messages.push(...replacement);
      }
    }
  }

  return { agentLoop, system, tools };
}
