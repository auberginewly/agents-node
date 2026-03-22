/**
 * s03 — TodoManager：模型通过 `todo` 工具维护结构化进度；同时只允许一个 in_progress。
 */
export class TodoManager {
  constructor() {
    this.items = [];
  }

  update(items) {
    if (items.length > 20) {
      throw new Error("Max 20 todos allowed");
    }
    const validated = [];
    let inProgressCount = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const text = String(item.text ?? "").trim();
      const status = String(item.status ?? "pending").toLowerCase();
      const id = String(item.id ?? String(i + 1));
      if (!text) throw new Error(`Item ${id}: text required`);
      if (!["pending", "in_progress", "completed"].includes(status)) {
        throw new Error(`Item ${id}: invalid status '${status}'`);
      }
      if (status === "in_progress") inProgressCount += 1;
      validated.push({ id, text, status });
    }
    if (inProgressCount > 1) {
      throw new Error("Only one task can be in_progress at a time");
    }
    this.items = validated;
    return this.render();
  }

  render() {
    if (!this.items.length) return "No todos.";
    const marker = { pending: "[ ]", in_progress: "[>]", completed: "[x]" };
    const lines = this.items.map(
      (t) => `${marker[t.status]} #${t.id}: ${t.text}`,
    );
    const done = this.items.filter((t) => t.status === "completed").length;
    lines.push(`\n(${done}/${this.items.length} completed)`);
    return lines.join("\n");
  }
}
