/**
 * Web 会话持久化：工作区 .web-sessions/<id>.json（Anthropic 风格 messages[]）。
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const DIR_NAME = ".web-sessions";

export function sessionsDir(repoRoot) {
  return join(repoRoot, DIR_NAME);
}

function sessionPath(repoRoot, sessionId) {
  const safe = String(sessionId).replace(/[^a-f0-9-]/gi, "");
  if (safe !== sessionId || !safe) throw new Error("invalid session id");
  return join(sessionsDir(repoRoot), `${safe}.json`);
}

export function loadAllSessions(repoRoot) {
  const dir = sessionsDir(repoRoot);
  const map = new Map();
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return map;
  }
  let files;
  try {
    files = readdirSync(dir);
  } catch {
    return map;
  }
  for (const name of files) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -5);
    try {
      const raw = readFileSync(join(dir, name), "utf8");
      const data = JSON.parse(raw);
      if (data?.id === id && Array.isArray(data.messages)) {
        map.set(id, data.messages);
      }
    } catch {
      /* skip corrupt */
    }
  }
  return map;
}

export function persistSession(repoRoot, sessionId, messages) {
  const safe = String(sessionId).replace(/[^a-f0-9-]/gi, "");
  if (safe !== sessionId || !safe) return;
  const dir = sessionsDir(repoRoot);
  mkdirSync(dir, { recursive: true });
  const payload = {
    id: sessionId,
    updatedAt: Date.now(),
    messages,
  };
  writeFileSync(
    join(dir, `${safe}.json`),
    JSON.stringify(payload),
    "utf8",
  );
}

export function deleteSessionFile(repoRoot, sessionId) {
  const safe = String(sessionId).replace(/[^a-f0-9-]/gi, "");
  if (safe !== sessionId || !safe) return;
  try {
    unlinkSync(sessionPath(repoRoot, sessionId));
  } catch {
    /* ignore */
  }
}

export function listSessionSummaries(repoRoot, sessionsMap) {
  const dir = sessionsDir(repoRoot);
  const out = [];
  for (const [id, messages] of sessionsMap.entries()) {
    let preview = "";
    const messageCount = messages.length;
    for (const m of messages) {
      if (m.role === "user") {
        const t = userTextPreview(m.content);
        if (t) {
          preview = t.slice(0, 80) + (t.length > 80 ? "…" : "");
          break;
        }
      }
    }
    let updatedAt = 0;
    try {
      updatedAt = statSync(join(dir, `${id}.json`)).mtimeMs;
    } catch {
      updatedAt = Date.now();
    }
    out.push({ id, updatedAt, preview, messageCount });
  }
  out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return out;
}

function userTextPreview(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b?.type === "text" && b.text)
    .map((b) => b.text)
    .join("\n")
    .trim();
}
