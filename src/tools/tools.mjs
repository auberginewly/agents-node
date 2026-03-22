/**
 * s02 — 文件沙箱 + bash：所有路径相对于仓库根 REPO_ROOT。
 */
import { exec } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { dirname, relative, resolve, sep } from "node:path";

const execAsync = promisify(exec);

export function createFilesystemTools(repoRoot) {
  function safePath(p) {
    const target = resolve(repoRoot, p);
    const rel = relative(repoRoot, target);
    if (rel.startsWith("..") || rel.split(sep).includes("..")) {
      throw new Error(`Path escapes workspace: ${p}`);
    }
    return target;
  }

  async function runBash(command) {
    const dangerous = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"];
    if (dangerous.some((d) => command.includes(d))) {
      return "Error: Dangerous command blocked";
    }
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: repoRoot,
        shell: true,
        timeout: 120_000,
        maxBuffer: 50 * 1024 * 1024,
      });
      const out = (stdout + stderr).trim();
      return out ? out.slice(0, 50000) : "(no output)";
    } catch (e) {
      if (e?.code === "ETIMEDOUT" || e?.signal === "SIGTERM") {
        return "Error: Timeout (120s)";
      }
      const errText = [e.stderr, e.stdout, e.message].filter(Boolean).join("\n").trim();
      return errText ? errText.slice(0, 50000) : String(e).slice(0, 50000);
    }
  }

  function runRead(path, limit) {
    try {
      const text = readFileSync(safePath(path), "utf8");
      const lines = text.split(/\r?\n/);
      if (limit != null && limit < lines.length) {
        const rest = lines.length - limit;
        lines.splice(limit, lines.length - limit, `... (${rest} more lines)`);
      }
      return lines.join("\n").slice(0, 50000);
    } catch (e) {
      return `Error: ${e.message ?? e}`;
    }
  }

  function runWrite(path, content) {
    try {
      const fp = safePath(path);
      mkdirSync(dirname(fp), { recursive: true });
      writeFileSync(fp, content, "utf8");
      return `Wrote ${content.length} bytes to ${path}`;
    } catch (e) {
      return `Error: ${e.message ?? e}`;
    }
  }

  function runEdit(path, oldText, newText) {
    try {
      const fp = safePath(path);
      const content = readFileSync(fp, "utf8");
      if (!content.includes(oldText)) {
        return `Error: Text not found in ${path}`;
      }
      writeFileSync(fp, content.replace(oldText, newText), "utf8");
      return `Edited ${path}`;
    } catch (e) {
      return `Error: ${e.message ?? e}`;
    }
  }

  return { safePath, runBash, runRead, runWrite, runEdit };
}
