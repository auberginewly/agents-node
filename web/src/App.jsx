import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { renderAssistantMarkdown } from "./markdown.mjs";
import { useChatScroll } from "./useChatScroll.js";

function textFromAssistantContent(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("");
}

function userTextFromAnthropicContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b?.type === "text" && b.text)
    .map((b) => b.text)
    .join("\n");
}

function isToolResultOnlyUser(content) {
  if (typeof content === "string") return false;
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every((b) => b?.type === "tool_result");
}

/** 将服务端持久化的 messages[] 转成单个标签页 */
function anthropicSessionToChat(sessionId, anthropicMessages) {
  const uiMsgs = [];
  for (const m of anthropicMessages) {
    if (m.role === "user") {
      if (isToolResultOnlyUser(m.content)) continue;
      const text = userTextFromAnthropicContent(m.content).trim();
      if (text)
        uiMsgs.push({ id: crypto.randomUUID(), role: "user", text });
    } else if (m.role === "assistant") {
      const text = textFromAssistantContent(m.content);
      if (text)
        uiMsgs.push({ id: crypto.randomUUID(), role: "assistant", text });
    }
  }
  const firstUser = uiMsgs.find((m) => m.role === "user");
  const title = firstUser
    ? firstUser.text.slice(0, 20) + (firstUser.text.length > 20 ? "…" : "")
    : "新对话";
  return {
    id: crypto.randomUUID(),
    sessionId,
    title,
    messages: uiMsgs,
    tools: [],
    logs: [],
    draft: "",
  };
}

function toolOutputStatus(output) {
  const s = String(output ?? "");
  if (/^Error:/i.test(s.trim()) || /^Unknown tool:/i.test(s.trim()))
    return "error";
  return "ok";
}

function createChat() {
  const id = crypto.randomUUID();
  return {
    id,
    title: "新对话",
    sessionId: null,
    messages: [],
    tools: [],
    logs: [],
    draft: "",
  };
}

function initialApp() {
  const chat = createChat();
  return { chats: [chat], activeChatId: chat.id };
}

const SUGGESTIONS_FALLBACK = [
  "用一句话说明这个 agents-node 项目是做什么的",
  "列出仓库根目录下的主要文件夹",
  "解释 agent 循环里 eventSink 的用途",
];

function AssistantBody({ markdownSource }) {
  const html = useMemo(
    () => renderAssistantMarkdown(markdownSource),
    [markdownSource],
  );
  const wrapRef = useRef(null);

  useEffect(() => {
    const root = wrapRef.current;
    if (!root) return;
    const onClick = (e) => {
      const btn = e.target.closest(".copy-code-btn");
      if (!btn || !root.contains(btn)) return;
      const wrap = btn.closest(".code-block-wrap");
      const code = wrap?.querySelector("pre code");
      const text = code?.textContent ?? "";
      navigator.clipboard.writeText(text).then(
        () => {
          const prev = btn.textContent;
          btn.textContent = "已复制";
          setTimeout(() => {
            btn.textContent = prev;
          }, 1600);
        },
        () => {
          btn.textContent = "失败";
          setTimeout(() => {
            btn.textContent = "复制";
          }, 1600);
        },
      );
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [html]);

  return (
    <div
      ref={wrapRef}
      className="bubble-body"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default function App() {
  const [app, setApp] = useState(initialApp);
  const { chats, activeChatId } = app;

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeChatId) ?? chats[0],
    [chats, activeChatId],
  );

  const [meta, setMeta] = useState("加载中…");
  const [sendingChatId, setSendingChatId] = useState(null);
  const [banner, setBanner] = useState(null);
  const [toolsCollapsed, setToolsCollapsed] = useState(false);
  const [liveRegion, setLiveRegion] = useState("");
  /** null = 加载中；空会话时向 /api/suggestions 拉 AI 生成的示例 */
  const [suggestions, setSuggestions] = useState(null);
  const abortRef = useRef(null);
  const textareaRef = useRef(null);
  const streamDoneRef = useRef(false);
  const sseTargetChatIdRef = useRef(null);
  const sendingChatIdRef = useRef(null);
  const streamingAssistMsgIdRef = useRef(null);

  useEffect(() => {
    sendingChatIdRef.current = sendingChatId;
  }, [sendingChatId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/sessions");
        const j = await r.json();
        if (cancelled || !j.sessions?.length) return;
        const full = await Promise.all(
          j.sessions.map((s) =>
            fetch(`/api/sessions/${encodeURIComponent(s.id)}`).then((x) =>
              x.json(),
            ),
          ),
        );
        if (cancelled) return;
        const restored = full
          .filter((row) => row.id && Array.isArray(row.messages))
          .map((row) => anthropicSessionToChat(row.id, row.messages));
        if (restored.length === 0) return;
        setApp({
          chats: restored,
          activeChatId: restored[0].id,
        });
        setLiveRegion(`已恢复 ${restored.length} 个会话`);
      } catch {
        /* 保持默认空会话 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const messages = activeChat?.messages ?? [];
  const tools = activeChat?.tools ?? [];
  const logs = activeChat?.logs ?? [];
  const draft = activeChat?.draft ?? "";

  useEffect(() => {
    if (messages.length !== 0) return;
    let cancelled = false;
    setSuggestions(null);
    (async () => {
      try {
        const r = await fetch("/api/suggestions");
        const j = await r.json();
        if (cancelled) return;
        if (Array.isArray(j.suggestions) && j.suggestions.length > 0) {
          setSuggestions(j.suggestions.slice(0, 3));
        } else {
          setSuggestions([...SUGGESTIONS_FALLBACK]);
        }
      } catch {
        if (!cancelled) setSuggestions([...SUGGESTIONS_FALLBACK]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeChatId, messages.length]);

  const sending = sendingChatId != null;
  const sendingHere = sendingChatId === activeChatId;

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [draft, activeChatId]);

  const chatRef = useChatScroll(messages, tools, logs, sending, banner);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((j) => {
        setMeta(
          `model: ${j.model} · workspace: ${j.repoRoot}${j.minimal ? " · minimal" : ""}`,
        );
      })
      .catch(() => {
        setMeta("无法连接 /api/health（请先 npm run web 或检查 Vite 代理）");
      });
  }, []);

  const setDraftForActive = useCallback(
    (value) => {
      setApp((a) => ({
        ...a,
        chats: a.chats.map((c) =>
          c.id === a.activeChatId ? { ...c, draft: value } : c,
        ),
      }));
    },
    [],
  );

  const addChat = useCallback(() => {
    setApp((a) => {
      const next = createChat();
      return {
        chats: [...a.chats, next],
        activeChatId: next.id,
      };
    });
    setBanner(null);
    setLiveRegion("已新建对话");
  }, []);

  const selectChat = useCallback((id) => {
    setApp((a) => ({ ...a, activeChatId: id }));
  }, []);

  const closeChat = useCallback((id, e) => {
    e?.stopPropagation();
    if (sendingChatIdRef.current === id) abortRef.current?.abort();
    setApp((a) => {
      if (a.chats.length <= 1) return a;
      const closing = a.chats.find((c) => c.id === id);
      const serverId = closing?.sessionId;
      if (serverId) {
        fetch(`/api/sessions/${encodeURIComponent(serverId)}`, {
          method: "DELETE",
        }).catch(() => {});
      }
      const idx = a.chats.findIndex((c) => c.id === id);
      const nextChats = a.chats.filter((c) => c.id !== id);
      let nextActive = a.activeChatId;
      if (a.activeChatId === id) {
        const fall = idx > 0 ? idx - 1 : 0;
        nextActive = nextChats[fall]?.id ?? nextChats[0].id;
      }
      return { chats: nextChats, activeChatId: nextActive };
    });
  }, []);

  const handleSseEvent = useCallback((evt) => {
    const cid = sseTargetChatIdRef.current;
    if (!cid) return;

    if (evt.type === "session" && evt.sessionId) {
      setApp((a) => ({
        ...a,
        chats: a.chats.map((c) =>
          c.id === cid ? { ...c, sessionId: evt.sessionId } : c,
        ),
      }));
      return;
    }
    if (evt.type === "assistant_delta" && evt.text) {
      setApp((a) => ({
        ...a,
        chats: a.chats.map((c) => {
          if (c.id !== cid) return c;
          const msgs = [...c.messages];
          let sid = streamingAssistMsgIdRef.current;
          if (!sid) {
            sid = crypto.randomUUID();
            streamingAssistMsgIdRef.current = sid;
            msgs.push({
              id: sid,
              role: "assistant",
              text: evt.text,
              streaming: true,
            });
          } else {
            const i = msgs.findIndex((m) => m.id === sid);
            if (i >= 0) {
              msgs[i] = {
                ...msgs[i],
                text: msgs[i].text + evt.text,
                streaming: true,
              };
            }
          }
          return { ...c, messages: msgs };
        }),
      }));
      return;
    }
    if (evt.type === "assistant") {
      const t = textFromAssistantContent(evt.content);
      const prevStreamId = streamingAssistMsgIdRef.current;
      streamingAssistMsgIdRef.current = null;
      setApp((a) => ({
        ...a,
        chats: a.chats.map((c) => {
          if (c.id !== cid) return c;
          const msgs = [...c.messages];
          if (prevStreamId) {
            const i = msgs.findIndex((m) => m.id === prevStreamId);
            if (i >= 0) {
              if (t)
                msgs[i] = { ...msgs[i], text: t, streaming: false };
              else msgs.splice(i, 1);
            } else if (t) {
              msgs.push({
                id: crypto.randomUUID(),
                role: "assistant",
                text: t,
              });
            }
          } else if (t) {
            msgs.push({
              id: crypto.randomUUID(),
              role: "assistant",
              text: t,
            });
          }
          return { ...c, messages: msgs };
        }),
      }));
      if (t) setLiveRegion(t.slice(0, 400));
      return;
    }
    if (evt.type === "tool_start") {
      setApp((a) => ({
        ...a,
        chats: a.chats.map((c) =>
          c.id === cid
            ? {
                ...c,
                tools: [
                  ...c.tools,
                  {
                    id: evt.id,
                    name: evt.name ?? "tool",
                    input: evt.input,
                    output: null,
                    durationMs: null,
                    status: "pending",
                  },
                ],
              }
            : c,
        ),
      }));
      return;
    }
    if (evt.type === "tool_end") {
      const out = evt.output ?? "";
      const status = toolOutputStatus(out);
      setApp((a) => ({
        ...a,
        chats: a.chats.map((c) =>
          c.id === cid
            ? {
                ...c,
                tools: c.tools.map((row) =>
                  row.id === evt.id
                    ? {
                        ...row,
                        output: out.slice(0, 4000),
                        durationMs: evt.durationMs,
                        status,
                      }
                    : row,
                ),
              }
            : c,
        ),
      }));
      return;
    }
    if (evt.type === "error") {
      streamingAssistMsgIdRef.current = null;
      const msg = evt.message ?? "未知错误";
      setApp((a) => ({
        ...a,
        chats: a.chats.map((c) =>
          c.id === cid
            ? {
                ...c,
                messages: [
                  ...c.messages.filter((m) => !m.streaming),
                  {
                    id: crypto.randomUUID(),
                    role: "assistant",
                    text: `**错误** ${msg}`,
                  },
                ],
              }
            : c,
        ),
      }));
      setBanner(msg);
      return;
    }
    if (evt.type === "log" && evt.message) {
      setApp((a) => ({
        ...a,
        chats: a.chats.map((c) =>
          c.id === cid
            ? { ...c, logs: [...c.logs, String(evt.message)] }
            : c,
        ),
      }));
    }
  }, []);

  const appendAssistantToChat = useCallback((cid, text) => {
    const t = String(text);
    streamingAssistMsgIdRef.current = null;
    setApp((a) => ({
      ...a,
      chats: a.chats.map((c) =>
        c.id === cid
          ? {
              ...c,
              messages: [
                ...c.messages.filter((m) => !m.streaming),
                { id: crypto.randomUUID(), role: "assistant", text: t },
              ],
            }
          : c,
      ),
    }));
  }, []);

  const consumeSse = useCallback(
    async (response, ac) => {
      const reader = response.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      streamDoneRef.current = false;
      const cid = sseTargetChatIdRef.current;
      try {
        while (!ac.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            for (const line of chunk.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              let evt;
              try {
                evt = JSON.parse(line.slice(6));
              } catch {
                continue;
              }
              handleSseEvent(evt);
              if (evt.type === "done") {
                streamDoneRef.current = true;
                return;
              }
            }
          }
        }
      } catch (e) {
        if (ac.signal.aborted || e?.name === "AbortError") return;
        setBanner(e?.message ?? String(e));
        if (cid)
          appendAssistantToChat(
            cid,
            `**连接中断** ${e?.message ?? e}`,
          );
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* ignore */
        }
        if (ac.signal.aborted && !streamDoneRef.current && cid) {
          appendAssistantToChat(cid, "_已停止本次请求。_");
        }
      }
    },
    [appendAssistantToChat, handleSseEvent],
  );

  const sendMessage = useCallback(async () => {
    const text = draft.trim();
    const cid = activeChatId;
    const sessionId =
      chats.find((c) => c.id === cid)?.sessionId ?? null;
    if (!text || sending || !cid) return;

    streamingAssistMsgIdRef.current = null;
    sseTargetChatIdRef.current = cid;
    setApp((a) => ({
      ...a,
      chats: a.chats.map((c) => {
        if (c.id !== cid) return c;
        const userMsg = {
          id: crypto.randomUUID(),
          role: "user",
          text,
        };
        const wasNew = c.messages.length === 0 && c.title === "新对话";
        const title = wasNew
          ? text.slice(0, 20) + (text.length > 20 ? "…" : "")
          : c.title;
        return {
          ...c,
          messages: [...c.messages, userMsg],
          title,
          draft: "",
        };
      }),
    }));

    setSendingChatId(cid);
    setBanner(null);
    const ac = new AbortController();
    abortRef.current = ac;

    let res;
    try {
      res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId }),
        signal: ac.signal,
      });
    } catch (e) {
      if (e.name === "AbortError") {
        appendAssistantToChat(cid, "_已停止本次请求。_");
      } else {
        setBanner(e?.message ?? String(e));
        appendAssistantToChat(cid, `**请求失败** ${e?.message ?? e}`);
      }
      setSendingChatId(null);
      abortRef.current = null;
      return;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      setBanner(`HTTP ${res.status}`);
      appendAssistantToChat(
        cid,
        `**请求失败** ${res.status} ${errText.slice(0, 200)}`,
      );
      setSendingChatId(null);
      abortRef.current = null;
      return;
    }

    await consumeSse(res, ac);
    setSendingChatId(null);
    abortRef.current = null;
  }, [
    draft,
    sending,
    activeChatId,
    chats,
    appendAssistantToChat,
    consumeSse,
  ]);

  const stopSending = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const empty = messages.length === 0;

  return (
    <>
      <div className="sr-only" aria-live="polite">
        {liveRegion}
      </div>
      <header className="top">
        <div className="top-row">
          <h1>agents-node</h1>
        </div>
        <div className="meta" id="meta">
          {meta}
        </div>
      </header>

      <nav className="tab-bar" aria-label="对话列表">
        <div className="tab-bar-scroll" role="tablist">
          {chats.map((c) => {
            const isActive = c.id === activeChatId;
            const isSending = sendingChatId === c.id;
            return (
              <div
                key={c.id}
                className={`tab-item ${isActive ? "tab-item--active" : ""} ${isSending ? "tab-item--pending" : ""}`}
                role="presentation"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className="tab-btn"
                  onClick={() => selectChat(c.id)}
                >
                  <span className="tab-title">{c.title}</span>
                  {isSending ? (
                    <span className="tab-sending" aria-hidden="true" />
                  ) : null}
                </button>
                {chats.length > 1 ? (
                  <button
                    type="button"
                    className="tab-close"
                    aria-label={`关闭 ${c.title}`}
                    onClick={(e) => closeChat(c.id, e)}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            );
          })}
          <button
            type="button"
            className="tab-add"
            aria-label="新建对话"
            onClick={addChat}
          >
            +
          </button>
        </div>
      </nav>

      <main className="layout">
        <section
          className="chat"
          id="chat"
          ref={chatRef}
          aria-label="对话消息"
        >
          {empty ? (
            <div className="empty-state">
              <p className="empty-title">开始对话</p>
              <p className="empty-hint">
                可在上方标签切换多个会话；Enter 发送，Shift+Enter 换行。
              </p>
              {suggestions === null ? (
                <p className="suggestions-loading">正在生成示例问题…</p>
              ) : (
                <ul className="suggestions">
                  {suggestions.map((s, i) => (
                    <li key={`${i}-${s.slice(0, 24)}`}>
                      <button
                        type="button"
                        className="suggestion-chip"
                        onClick={() => setDraftForActive(s)}
                      >
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
          {messages.map((m) => (
            <article key={m.id} className={`bubble ${m.role}`}>
              <div className="role">
                {m.role === "user" ? "你" : "助手"}
              </div>
              {m.role === "assistant" ? (
                <AssistantBody markdownSource={m.text} />
              ) : (
                <div className="bubble-body user-plain">{m.text}</div>
              )}
            </article>
          ))}
          {sendingHere &&
          !messages.some((m) => m.role === "assistant" && m.streaming) ? (
            <div className="typing-bar" aria-hidden="true">
              <span className="typing-dots">
                <span />
                <span />
                <span />
              </span>
              <span className="typing-label">生成中…</span>
            </div>
          ) : null}
        </section>

        <aside
          className={`tools ${toolsCollapsed ? "tools--collapsed" : ""}`}
          id="tools"
          aria-label="工具调用"
        >
          <div className="tools-head">
            <h2>工具</h2>
            <button
              type="button"
              className="btn-ghost btn-small"
              onClick={() => setToolsCollapsed((c) => !c)}
              aria-expanded={!toolsCollapsed}
            >
              {toolsCollapsed ? "展开" : "收起"}
            </button>
          </div>
          {!toolsCollapsed ? (
            <>
              {logs.length ? (
                <details className="log-block">
                  <summary>系统日志 ({logs.length})</summary>
                  <ul className="log-list">
                    {logs.map((line, i) => (
                      <li key={`${i}-${line.slice(0, 12)}`}>{line}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <div id="toolLog" className="tool-log">
                {tools.length === 0 ? (
                  <p className="tool-empty">尚无工具调用</p>
                ) : (
                  tools.map((t) => (
                    <details
                      key={t.id}
                      className={`tool-item tool-item--${t.status}`}
                      defaultOpen={t.status === "pending"}
                    >
                      <summary className="tool-summary">
                        <span className="tool-name">{t.name}</span>
                        <span className="tool-meta">
                          {t.status === "pending" ? (
                            <span className="badge badge-pending">运行中</span>
                          ) : (
                            <span
                              className={
                                t.status === "error"
                                  ? "badge badge-error"
                                  : "badge badge-ok"
                              }
                            >
                              {t.status === "error" ? "失败" : "完成"}
                            </span>
                          )}
                          {t.durationMs != null ? (
                            <span className="tool-ms">{t.durationMs} ms</span>
                          ) : null}
                        </span>
                      </summary>
                      {t.input != null && Object.keys(t.input).length ? (
                        <pre className="tool-pre tool-pre--input">
                          {JSON.stringify(t.input, null, 2).slice(0, 2000)}
                        </pre>
                      ) : null}
                      {t.output != null ? (
                        <pre className="tool-pre">{t.output}</pre>
                      ) : null}
                    </details>
                  ))
                )}
              </div>
            </>
          ) : null}
        </aside>
      </main>

      {banner ? (
        <div className="error-banner" role="alert">
          {banner}
        </div>
      ) : null}

      <footer className="input-bar">
        <textarea
          ref={textareaRef}
          id="msg"
          className="composer"
          rows={1}
          placeholder="输入消息，Enter 发送，Shift+Enter 换行…"
          autoComplete="off"
          value={draft}
          onChange={(e) => setDraftForActive(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={sending}
          aria-label="消息输入"
        />
        {sending ? (
          <button
            type="button"
            className="btn-stop"
            onClick={stopSending}
          >
            停止
          </button>
        ) : null}
        <button
          type="button"
          id="send"
          className="btn-send"
          onClick={sendMessage}
          disabled={sending || !draft.trim()}
        >
          发送
        </button>
      </footer>
    </>
  );
}
