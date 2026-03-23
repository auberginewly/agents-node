/**
 * 空会话引导问题：调用模型生成 3 条中文示例（失败则用静态兜底）。
 */

export const FALLBACK_SUGGESTIONS = [
  "用一句话说明这个 agents-node 项目是做什么的",
  "列出仓库根目录下的主要文件夹",
  "解释 agent 循环里 eventSink 的用途",
];

function textFromAssistantContent(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("");
}

function parseSuggestionsJson(raw) {
  let s = String(raw).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const arr = JSON.parse(s);
  if (!Array.isArray(arr)) return null;
  const out = arr
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, 3);
  return out.length ? out : null;
}

/** @param {any} client Anthropic SDK 客户端 */
export async function generateSuggestions(client, model, repoRoot) {
  const seed = Math.random().toString(36).slice(2, 10);
  const resp = await client.messages.create(
    {
      model,
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: `随机种子：${seed}

工作区路径：${repoRoot}
项目：agents-node，本地 Coding Agent（Node、Anthropic Messages 兼容 API、工具调用、可选 Web 演示）。

请生成恰好 3 条「用户点开空会话时展示的示例问题」，要求：
- 简体中文，每条不超过 45 字，口语化、可一点即发
- 可与本仓库、日常开发、或通用编程相关；因随机种子不同，每次角度尽量有变化
- 只输出一个合法 JSON 数组，形如 ["问题1","问题2","问题3"]
- 不要 markdown 代码块、不要前后解释文字`,
        },
      ],
    },
    { timeout: 45_000 },
  );

  const text = textFromAssistantContent(resp.content);
  let parsed;
  try {
    parsed = parseSuggestionsJson(text);
  } catch {
    return [...FALLBACK_SUGGESTIONS];
  }
  if (!parsed?.length) return [...FALLBACK_SUGGESTIONS];
  while (parsed.length < 3) {
    parsed.push(FALLBACK_SUGGESTIONS[parsed.length % FALLBACK_SUGGESTIONS.length]);
  }
  return parsed.slice(0, 3);
}
