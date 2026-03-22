/**
 * s07 — TaskManager：任务持久化为 .tasks/task_N.json，含 blockedBy / blocks 依赖图。
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class TaskManager {
  constructor(tasksDir) {
    this.dir = tasksDir;
    mkdirSync(this.dir, { recursive: true });
    this._nextId = this._maxId() + 1;
  }

  _maxId() {
    let max = 0;
    for (const f of readdirSync(this.dir, { withFileTypes: true })) {
      if (!f.isFile() || !f.name.startsWith("task_") || !f.name.endsWith(".json")) {
        continue;
      }
      const n = Number(f.name.replace(/^task_/, "").replace(/\.json$/, ""));
      if (!Number.isNaN(n)) max = Math.max(max, n);
    }
    return max;
  }

  _path(id) {
    return join(this.dir, `task_${id}.json`);
  }

  _load(taskId) {
    const p = this._path(taskId);
    try {
      return JSON.parse(readFileSync(p, "utf8"));
    } catch {
      throw new Error(`Task ${taskId} not found`);
    }
  }

  _save(task) {
    writeFileSync(this._path(task.id), JSON.stringify(task, null, 2), "utf8");
  }

  create(subject, description = "") {
    const task = {
      id: this._nextId,
      subject,
      description: description ?? "",
      status: "pending",
      blockedBy: [],
      blocks: [],
      owner: "",
    };
    this._save(task);
    this._nextId += 1;
    return JSON.stringify(task, null, 2);
  }

  get(taskId) {
    const id = Number(taskId);
    return JSON.stringify(this._load(id), null, 2);
  }

  update(taskId, status, addBlockedBy, addBlocks) {
    const id = Number(taskId);
    const task = this._load(id);
    if (status) {
      if (!["pending", "in_progress", "completed"].includes(status)) {
        throw new Error(`Invalid status: ${status}`);
      }
      task.status = status;
      if (status === "completed") {
        this._clearDependency(id);
      }
    }
    if (addBlockedBy?.length) {
      task.blockedBy = [...new Set([...task.blockedBy, ...addBlockedBy])];
    }
    if (addBlocks?.length) {
      task.blocks = [...new Set([...task.blocks, ...addBlocks])];
      for (const blockedId of addBlocks) {
        try {
          const blocked = this._load(blockedId);
          if (!blocked.blockedBy.includes(id)) {
            blocked.blockedBy.push(id);
            this._save(blocked);
          }
        } catch {
          /* skip missing */
        }
      }
    }
    this._save(task);
    return JSON.stringify(task, null, 2);
  }

  _clearDependency(completedId) {
    for (const f of readdirSync(this.dir, { withFileTypes: true })) {
      if (!f.isFile() || !f.name.endsWith(".json")) continue;
      const p = join(this.dir, f.name);
      const task = JSON.parse(readFileSync(p, "utf8"));
      const bb = task.blockedBy ?? [];
      if (bb.includes(completedId)) {
        task.blockedBy = bb.filter((x) => x !== completedId);
        writeFileSync(p, JSON.stringify(task, null, 2), "utf8");
      }
    }
  }

  listAll() {
    const files = readdirSync(this.dir)
      .filter((n) => n.startsWith("task_") && n.endsWith(".json"))
      .sort();
    const tasks = files.map((n) =>
      JSON.parse(readFileSync(join(this.dir, n), "utf8")),
    );
    if (!tasks.length) return "No tasks.";
    const marker = { pending: "[ ]", in_progress: "[>]", completed: "[x]" };
    const lines = tasks.map((t) => {
      const m = marker[t.status] ?? "[?]";
      const blocked =
        t.blockedBy?.length > 0
          ? ` (blocked by: ${JSON.stringify(t.blockedBy)})`
          : "";
      return `${m} #${t.id}: ${t.subject}${blocked}`;
    });
    return lines.join("\n");
  }
}
