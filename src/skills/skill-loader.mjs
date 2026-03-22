/**
 * s05 — SkillLoader：扫描 skills 下各子目录中的 SKILL.md；Layer1 摘要进 system，Layer2 全文经 load_skill 注入 tool_result。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return [{}, text.trim()];
  const meta = {};
  for (const line of m[1].trim().split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return [meta, m[2].trim()];
}

function walkSkillFiles(dir, out = []) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p, { throwIfNoEntry: false });
    if (!st) continue;
    if (st.isDirectory()) walkSkillFiles(p, out);
    else if (name === "SKILL.md") out.push(p);
  }
  return out.sort();
}

export class SkillLoader {
  constructor(skillsDir) {
    this.skillsDir = skillsDir;
    this.skills = new Map();
    this._loadAll();
  }

  _loadAll() {
    for (const file of walkSkillFiles(this.skillsDir)) {
      const text = readFileSync(file, "utf8");
      const [meta, body] = parseFrontmatter(text);
      const name = meta.name || file.split(/[/\\]/).slice(-2, -1)[0];
      this.skills.set(name, { meta, body, path: file });
    }
  }

  getDescriptions() {
    if (!this.skills.size) return "(no skills available)";
    const lines = [];
    for (const [name, skill] of this.skills) {
      const desc = skill.meta.description || "No description";
      const tags = skill.meta.tags;
      let line = `  - ${name}: ${desc}`;
      if (tags) line += ` [${tags}]`;
      lines.push(line);
    }
    return lines.join("\n");
  }

  getContent(name) {
    const skill = this.skills.get(name);
    if (!skill) {
      return `Error: Unknown skill '${name}'. Available: ${[...this.skills.keys()].join(", ")}`;
    }
    return `<skill name="${name}">\n${skill.body}\n</skill>`;
  }
}
