/**
 * s04 — 子智能体：独立 messages，仅用 CHILD_TOOLS（无 task，避免递归）；只把最终文本摘要回父对话。
 */
export function createRunSubagent({
  client,
  model,
  subagentSystem,
  childTools,
  baseHandlers,
  maxTurns = 30,
}) {
  return async function runSubagent(prompt) {
    const subMessages = [{ role: "user", content: prompt }];
    let response;
    for (let i = 0; i < maxTurns; i++) {
      response = await client.messages.create({
        model,
        system: subagentSystem,
        messages: subMessages,
        tools: childTools,
        max_tokens: 8000,
      });
      subMessages.push({ role: "assistant", content: response.content });
      if (response.stop_reason !== "tool_use") break;

      const results = [];
      for (const block of response.content) {
        if (block.type === "tool_use") {
          const handler = baseHandlers[block.name];
          const output = handler
            ? await handler(block.input ?? {})
            : `Unknown tool: ${block.name}`;
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: String(output).slice(0, 50000),
          });
        }
      }
      subMessages.push({ role: "user", content: results });
    }

    const blocks = response?.content ?? [];
    const text = blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    return text || "(no summary)";
  };
}
