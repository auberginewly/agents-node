#!/usr/bin/env node
/**
 * Web 演示：静态页 + POST /api/chat（SSE，含 assistant_delta 流式）；
 * 会话持久化到工作区 .web-sessions/，重启可恢复。
 */
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  loadEnv,
  requireModelId,
  createClient,
  REPO_ROOT,
} from "../src/core/config.mjs";
import { createAgentRuntime } from "../src/agent/loop.mjs";
import {
  loadAllSessions,
  persistSession,
  deleteSessionFile,
  listSessionSummaries,
} from "./session-store.mjs";
import {
  generateSuggestions,
  FALLBACK_SUGGESTIONS,
} from "./suggestions.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(__dirname, "..", "web");
const WEB_DIST = join(WEB_ROOT, "dist");
const STATIC_ROOT =
  existsSync(join(WEB_DIST, "index.html")) ? WEB_DIST : WEB_ROOT;
const PORT = Number(process.env.WEB_PORT || "3847");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".map": "application/json",
  ".woff2": "font/woff2",
};

/** sessionId -> Anthropic-style messages[] */
const sessions = loadAllSessions(REPO_ROOT);

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function sendSse(res, eventObj) {
  res.write(`data: ${JSON.stringify(eventObj)}\n\n`);
}

function staticFile(relPath) {
  const safe = relPath.replace(/\.\./g, "").replace(/^\/+/, "");
  const full = join(STATIC_ROOT, safe);
  if (!full.startsWith(STATIC_ROOT) || !existsSync(full)) return null;
  try {
    return readFileSync(full);
  } catch {
    return null;
  }
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function safeSessionId(id) {
  const s = String(id ?? "");
  if (!/^[a-f0-9-]{36}$/i.test(s)) return null;
  return s;
}

loadEnv();
const model = requireModelId();
const minimal = process.env.AGENT_MINIMAL === "1";
const client = createClient();

const { agentLoop } = createAgentRuntime({
  client,
  model,
  repoRoot: REPO_ROOT,
  minimal,
});

async function handleRequest(req, res) {
  const url = new URL(req.url || "/", `http://127.0.0.1`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      model,
      repoRoot: REPO_ROOT,
      minimal,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/suggestions") {
    if (process.env.WEB_SUGGESTIONS_AI === "0") {
      sendJson(res, 200, { suggestions: [...FALLBACK_SUGGESTIONS] });
      return;
    }
    try {
      const suggestions = await generateSuggestions(client, model, REPO_ROOT);
      sendJson(res, 200, { suggestions });
    } catch (e) {
      console.warn("GET /api/suggestions:", e?.message ?? e);
      sendJson(res, 200, { suggestions: [...FALLBACK_SUGGESTIONS] });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/sessions") {
    sendJson(res, 200, {
      sessions: listSessionSummaries(REPO_ROOT, sessions),
    });
    return;
  }

  const sessionGet = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (req.method === "GET" && sessionGet) {
    const sid = safeSessionId(sessionGet[1]);
    if (!sid) {
      sendJson(res, 400, { error: "invalid session id" });
      return;
    }
    const messages = sessions.get(sid);
    if (!messages) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    sendJson(res, 200, { id: sid, messages });
    return;
  }

  if (req.method === "DELETE" && sessionGet) {
    const sid = safeSessionId(sessionGet[1]);
    if (!sid) {
      sendJson(res, 400, { error: "invalid session id" });
      return;
    }
    sessions.delete(sid);
    deleteSessionFile(REPO_ROOT, sid);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    const body = await readJsonBody(req);
    if (body === null) {
      sendJson(res, 400, { error: "Invalid JSON" });
      return;
    }
    const message = String(body.message ?? "").trim();
    if (!message) {
      sendJson(res, 400, { error: "message required" });
      return;
    }
    let sessionId = body.sessionId;
    if (sessionId != null && sessionId !== "") {
      const s = safeSessionId(sessionId);
      if (!s) {
        sendJson(res, 400, { error: "invalid sessionId" });
        return;
      }
      sessionId = s;
    } else {
      sessionId = randomUUID();
    }
    if (!sessions.has(sessionId)) sessions.set(sessionId, []);
    const messages = sessions.get(sessionId);

    messages.push({ role: "user", content: message });

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    sendSse(res, { type: "session", sessionId });

    const eventSink = (evt) => sendSse(res, evt);
    const ac = new AbortController();
    const onClose = () => ac.abort();
    req.on("close", onClose);

    try {
      await agentLoop(messages, { eventSink, abortSignal: ac.signal });
      sendSse(res, { type: "done" });
    } catch (e) {
      const msg = e?.message ?? String(e);
      sendSse(res, {
        type: "error",
        message: msg,
      });
    } finally {
      req.off("close", onClose);
      try {
        persistSession(REPO_ROOT, sessionId, messages);
      } catch (err) {
        console.error("persistSession:", err);
      }
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
    return;
  }

  if (req.method === "GET") {
    let path = url.pathname === "/" ? "/index.html" : url.pathname;
    const buf = staticFile(path);
    if (buf) {
      const ext = extname(path);
      res.writeHead(200, {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(buf);
      return;
    }
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
}

function listenFrom(port, maxAttempts = 24) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    let currentPort = port;

    function tryListen() {
      const srv = http.createServer((req, res) => {
        handleRequest(req, res).catch((err) => {
          console.error(err);
          if (!res.headersSent) res.writeHead(500);
          res.end();
        });
      });

      const onError = (err) => {
        srv.removeListener("error", onError);
        srv.close(() => {});
        if (err.code === "EADDRINUSE" && attempt < maxAttempts) {
          if (attempt === 0) {
            console.warn(
              `端口 ${port} 已被占用（可能还有一个未退出的 npm run web）。\n` +
                `  可结束进程: lsof -ti :${port} | xargs kill\n` +
                `  或指定端口: WEB_PORT=4000 npm run web\n` +
                `  正在尝试 ${currentPort + 1}…`,
            );
          }
          attempt += 1;
          currentPort += 1;
          tryListen();
          return;
        }
        reject(err);
      };

      srv.once("error", onError);
      srv.listen(currentPort, () => {
        srv.removeListener("error", onError);
        srv.on("error", (e) => console.error("HTTP server error:", e));
        resolve({ srv, port: currentPort });
      });
    }

    tryListen();
  });
}

listenFrom(PORT)
  .then(({ port }) => {
    if (STATIC_ROOT === WEB_ROOT && !existsSync(join(WEB_DIST, "index.html"))) {
      console.warn(
        "未检测到 web/dist（请先执行 npm run build:web）。\n" +
          "  开发时可另开终端: npm run web:dev（Vite 5173，代理 /api → 本服务）",
      );
    }
    console.log(
      `Web UI: http://127.0.0.1:${port}/  (workspace: ${REPO_ROOT}, model: ${model})`,
    );
    console.log(
      `会话持久化: ${join(REPO_ROOT, ".web-sessions")}（${sessions.size} 条已加载）`,
    );
  })
  .catch((err) => {
    console.error("无法启动 Web 服务:", err.message);
    process.exit(1);
  });
