/**
 * s06 — 三层压缩：micro（旧 tool_result 占位）、auto（超长则摘要+落盘）、compact 工具手动触发。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const KEEP_RECENT = 3;
export const TOKEN_THRESHOLD = 50_000;

export function estimateTokens(messages) {
  return Math.floor(JSON.stringify(messages).length / 4);
}

/** 从 assistant 块解析 tool_use_id -> tool_name（兼容 SDK 对象） */
function buildToolNameMap(messages) {
  const map = {};
  for (const msg of messages) {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block?.type === "tool_use") {
        map[block.id] = block.name;
      }
    }
  }
  return map;
}

/**
 * Layer 1：仅保留最近 KEEP_RECENT 条 tool_result 全文，更早的改为占位符。
 */
export function microCompact(messages, keepRecent = KEEP_RECENT) {
  const toolResults = [];
  for (let mi = 0; mi < messages.length; mi++) {
    const msg = messages[mi];
    if (msg.role !== "user" || !Array.isArray(msg.content)) continue;
    msg.content.forEach((part, pi) => {
      if (part?.type === "tool_result") {
        toolResults.push({ msg: messages[mi], part });
      }
    });
  }
  if (toolResults.length <= keepRecent) return;

  const nameMap = buildToolNameMap(messages);
  const toClear = toolResults.slice(0, -keepRecent);
  for (const { part } of toClear) {
    const c = part.content;
    if (typeof c === "string" && c.length > 100) {
      const tid = part.tool_use_id ?? "";
      const toolName = nameMap[tid] || "unknown";
      part.content = `[Previous: used ${toolName}]`;
    }
  }
}

function messagesToJsonl(messages) {
  return messages
    .map((m) =>
      JSON.stringify({
        role: m.role,
        content: serializeContent(m.content),
      }),
    )
    .join("\n");
}

function serializeContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content);
  return content.map((b) => ({
    type: b.type,
    text: b.text,
    id: b.id,
    name: b.name,
    input: b.input,
    content: typeof b.content === "string" ? b.content : b.content,
    tool_use_id: b.tool_use_id,
  }));
}

/**
 * Layer 2/3：落盘 transcript，调用模型摘要，用两条消息替换整条历史。
 */
export async function autoCompact(client, model, messages, transcriptDir) {
  await mkdir(transcriptDir, { recursive: true });
  const file = join(transcriptDir, `transcript_${Date.now()}.jsonl`);
  await writeFile(file, `${messagesToJsonl(messages)}\n`, "utf8");
  console.log(`[transcript saved: ${file}]`);

  const conversationText = JSON.stringify(messages).slice(0, 80_000);
  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content:
          "Summarize this conversation for continuity. Include: " +
          "1) What was accomplished, 2) Current state, 3) Key decisions made. " +
          "Be concise but preserve critical details.\n\n" +
          conversationText,
      },
    ],
  });

  const summary = response.content?.find((b) => b.type === "text")?.text ?? "";
  return [
    {
      role: "user",
      content: `[Conversation compressed. Transcript: ${file}]\n\n${summary}`,
    },
    {
      role: "assistant",
      content: "Understood. I have the context from the summary. Continuing.",
    },
  ];
}
