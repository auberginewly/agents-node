import DOMPurify from "dompurify";
import { marked, Renderer } from "marked";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

class MdRenderer extends Renderer {
  code({ text, lang }) {
    const langAttr = lang ? escapeHtml(String(lang)) : "";
    const cls = langAttr ? `language-${langAttr}` : "";
    const inner = escapeHtml(text);
    return `<div class="code-block-wrap"><button type="button" class="copy-code-btn" aria-label="复制代码">复制</button><pre><code class="${cls}">${inner}</code></pre></div>`;
  }
}

marked.use({
  gfm: true,
  breaks: true,
  renderer: new MdRenderer(),
});

const PURIFY = {
  ALLOWED_TAGS: [
    "p",
    "br",
    "strong",
    "em",
    "del",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "ul",
    "ol",
    "li",
    "blockquote",
    "code",
    "pre",
    "a",
    "hr",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "div",
    "button",
  ],
  ALLOWED_ATTR: ["href", "title", "target", "rel", "class", "type", "aria-label"],
};

export function renderAssistantMarkdown(text) {
  const raw = String(text);
  try {
    const html = marked.parse(raw, { async: false });
    return DOMPurify.sanitize(html, PURIFY);
  } catch {
    return escapeHtml(raw);
  }
}
