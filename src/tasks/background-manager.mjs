/**
 * s08 — 后台执行 shell：exec 回调非阻塞，完成后写入通知队列，主循环在每次 LLM 前 drain。
 */
import { exec } from "node:child_process";
import { randomUUID } from "node:crypto";

export class BackgroundManager {
  constructor(repoRoot) {
    this.repoRoot = repoRoot;
    /** @type {Map<string, {status: string, result: string|null, command: string}>} */
    this.tasks = new Map();
    /** @type {Array<{task_id: string, status: string, command: string, result: string}>} */
    this._notificationQueue = [];
  }

  run(command) {
    const taskId = randomUUID().slice(0, 8);
    this.tasks.set(taskId, {
      status: "running",
      result: null,
      command,
    });

    exec(
      command,
      {
        cwd: this.repoRoot,
        shell: true,
        timeout: 300_000,
        maxBuffer: 50 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        let output;
        let status;
        if (err?.killed || err?.code === "ETIMEDOUT") {
          output = "Error: Timeout (300s)";
          status = "timeout";
        } else if (err) {
          output = [stderr, stdout, err.message].filter(Boolean).join("\n").trim() || String(err);
          status = "error";
        } else {
          output = ((stdout || "") + (stderr || "")).trim() || "(no output)";
          output = output.slice(0, 50000);
          status = "completed";
        }
        const t = this.tasks.get(taskId);
        if (t) {
          t.status = status;
          t.result = output;
        }
        this._notificationQueue.push({
          task_id: taskId,
          status,
          command: command.slice(0, 80),
          result: output.slice(0, 500),
        });
      },
    );

    return `Background task ${taskId} started: ${command.slice(0, 80)}`;
  }

  check(taskId) {
    if (taskId) {
      const t = this.tasks.get(taskId);
      if (!t) return `Error: Unknown task ${taskId}`;
      return `[${t.status}] ${t.command.slice(0, 60)}\n${t.result ?? "(running)"}`;
    }
    const lines = [];
    for (const [tid, t] of this.tasks) {
      lines.push(`${tid}: [${t.status}] ${t.command.slice(0, 60)}`);
    }
    return lines.length ? lines.join("\n") : "No background tasks.";
  }

  drainNotifications() {
    const n = [...this._notificationQueue];
    this._notificationQueue.length = 0;
    return n;
  }
}
