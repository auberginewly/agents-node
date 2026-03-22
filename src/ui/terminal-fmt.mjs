/**
 * 终端展示：JSON 美化、工具框线、read_file 折叠/展开/Markdown 渲染。
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import stringWidth from "string-width";

export const ansi = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  green: "\x1b[32m",
};

/** /read 命令帮助（REPL 里用） */
export const READ_FILE_UI_HELP = `${ansi.cyan}/read${ansi.reset} 控制 read_file 在终端里的展示：
  ${ansi.dim}collapse${ansi.reset}   折叠：超长只显示前 N 行预览（默认）
  ${ansi.dim}expand${ansi.reset}     展开：整文件打在终端里（仍受安全长度上限）
  ${ansi.dim}pager${ansi.reset}      分页：写入缓存文件并用 ${ansi.dim}\$PAGER${ansi.reset}（默认 less -R）打开
  ${ansi.dim}status${ansi.reset}      当前模式
  ${ansi.dim}reset${ansi.reset}       取消会话覆盖，改回环境变量 ${ansi.dim}AGENT_READ_UI${ansi.reset}
环境变量：${ansi.dim}AGENT_READ_UI=collapsed|expanded|pager${ansi.reset} · ${ansi.dim}AGENT_READ_PREVIEW_LINES=18${ansi.reset}`;

let markedConfigured = false;

function ensureMarkedRenderer() {
  if (markedConfigured) return;
  const cols = Math.min(100, Math.max(40, process.stdout.columns || 80));
  marked.use(markedTerminal({ width: cols, reflowText: false }));
  markedConfigured = true;
}

export function renderMarkdownTerminal(src) {
  try {
    ensureMarkedRenderer();
    const out = marked.parse(String(src), { async: false });
    return typeof out === "string" ? out : String(out);
  } catch {
    return String(src);
  }
}

export function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, "");
}

/** 终端显示宽度（中文等全角算 2 列；会先去掉 ANSI） */
export function displayWidth(s) {
  return stringWidth(String(s));
}

/** 若整段像 JSON 对象/数组则缩进排版，否则原样返回 */
export function prettifyIfJson(str) {
  const raw = String(str);
  const t = raw.trim();
  if (!t || (t[0] !== "{" && t[0] !== "[")) return raw;
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return raw;
  }
}

/** null = 跟随环境变量 */
let readFileDisplayOverride = null;

function envReadUiMode() {
  const e = process.env.AGENT_READ_UI?.trim().toLowerCase();
  if (e === "expand" || e === "expanded" || e === "full") return "expanded";
  if (e === "pager") return "pager";
  return "collapsed";
}

export function setReadFileDisplayMode(mode) {
  if (mode === null || mode === "reset") readFileDisplayOverride = null;
  else readFileDisplayOverride = mode;
}

export function getReadFileDisplayMode() {
  return readFileDisplayOverride ?? envReadUiMode();
}

const MODE_LABEL = {
  collapsed: "折叠预览",
  expanded: "终端全文",
  pager: "分页器",
};

export function describeReadFileDisplayMode() {
  const eff = getReadFileDisplayMode();
  const label = MODE_LABEL[eff] ?? eff;
  const src =
    readFileDisplayOverride === null ? "环境变量 AGENT_READ_UI" : "本会话 /read 覆盖";
  return `${ansi.cyan}${label}${ansi.reset}（${ansi.dim}${src}${ansi.reset}）`;
}

function shouldRenderMarkdown(filePath, text) {
  if (process.env.AGENT_READ_MD === "0") return false;
  if (process.env.AGENT_READ_MD === "1") return true;
  if (filePath && /\.(md|mdx|markdown)$/i.test(filePath)) return true;
  const t = text.trimStart().slice(0, 800);
  if (/^#{1,6}\s/m.test(t) || t.startsWith("#")) return true;
  if (t.startsWith("---\n") || t.startsWith("---\r\n")) return true;
  return false;
}

function previewLineCount() {
  const n = Number.parseInt(process.env.AGENT_READ_PREVIEW_LINES ?? "18", 10);
  return Number.isFinite(n) && n > 0 ? n : 18;
}

function maxReadChars() {
  const n = Number.parseInt(process.env.AGENT_READ_MAX_CHARS ?? "120000", 10);
  return Number.isFinite(n) && n > 5000 ? n : 120_000;
}

function openPagerWithBody(bodyText, repoRoot, label) {
  if (!repoRoot) {
    return `${ansi.dim}[pager 需要工作区路径]${ansi.reset}`;
  }
  const dir = join(repoRoot, ".agent-cache");
  mkdirSync(dir, { recursive: true });
  const outFile = join(dir, "last-read-view.txt");
  writeFileSync(outFile, bodyText, "utf8");
  const pager = (process.env.PAGER || "less").trim();
  const isLess = pager === "less" || pager.endsWith("/less");
  let err;
  if (isLess) {
    const r = spawnSync("less", ["-R", "+1", outFile], { stdio: "inherit" });
    err = r.error;
  } else {
    const r = spawnSync(pager, [outFile], { stdio: "inherit", shell: true });
    err = r.error;
  }
  if (err) {
    console.log(
      `${ansi.dim}无法启动分页器（${err.message}），文件已写入:${ansi.reset}\n${outFile}`,
    );
  }
  return `${ansi.dim}[pager 已关闭]${ansi.reset} ${ansi.cyan}${label}${ansi.reset} → ${outFile}`;
}

function truncateLines(text, maxLines, maxChars) {
  const lines = text.split("\n");
  let out = lines.slice(0, maxLines).join("\n");
  if (lines.length > maxLines) {
    out += `\n${ansi.dim}… (${lines.length - maxLines} more lines)${ansi.reset}`;
  }
  if (out.length > maxChars) {
    return `${out.slice(0, maxChars)}\n${ansi.dim}… (${out.length - maxChars} more chars)${ansi.reset}`;
  }
  return out;
}

/**
 * 用 dim 框包多行（可含 ANSI）。
 * 宽度用 displayWidth（string-width），中文等全角占 2 列，右侧 │ 才能对齐。
 * 中间行结构为 │·内容·│，内容区固定为 contentW；顶/底横线在两个角之间宽 contentW+2。
 */
export function boxAnsiContent(title, bodyText, options = {}) {
  const { maxLines = 24, maxChars = 12000 } = options;
  const body = truncateLines(bodyText, maxLines, maxChars);
  const innerLines = body.split("\n");

  const titleBar = ` ${title} `.replace(/\s+$/, "");
  const cols = Math.max(40, process.stdout.columns || 80);
  const maxContentW = Math.max(24, cols - 4);

  const naturalW = Math.max(
    24,
    displayWidth(titleBar),
    ...innerLines.map((l) => displayWidth(l)),
  );
  const contentW = Math.min(naturalW, maxContentW);
  /** ╭ 与 ╮ 之间、不含角本身的宽度 = 左右各 1 空格 + 正文 contentW */
  const innerBorderW = contentW + 2;

  const d = ansi.dim;
  const r = ansi.reset;
  const titleW = displayWidth(titleBar);
  const topInner = titleBar + "─".repeat(Math.max(0, innerBorderW - titleW));
  const top = `${d}╭${topInner}╮${r}`;
  const bot = `${d}╰${"─".repeat(innerBorderW)}╯${r}`;

  const mid = innerLines
    .map((line) => {
      const w = displayWidth(line);
      const pad = Math.max(0, contentW - w);
      return `${d}│${r} ${line}${" ".repeat(pad)} ${d}│${r}`;
    })
    .join("\n");

  return `${top}\n${mid}\n${bot}`;
}

/**
 * read_file 专用：折叠 / 展开 / pager + 可选 Markdown 终端渲染。
 */
export function formatReadFileDisplay(filePath, rawText, options = {}) {
  const { repoRoot } = options;
  const text = String(rawText);
  const mode = getReadFileDisplayMode();
  const label = filePath || "(read_file)";

  if (text.startsWith("Error:")) {
    return boxAnsiContent(`read_file · ${label}`, text, options);
  }

  const capped =
    text.length > maxReadChars()
      ? `${text.slice(0, maxReadChars())}\n${ansi.dim}… 已截断至 ${maxReadChars()} 字符（可调 AGENT_READ_MAX_CHARS）${ansi.reset}`
      : text;

  const isMd = shouldRenderMarkdown(filePath, capped);
  const lines = capped.split("\n");
  const previewN = previewLineCount();
  const long = lines.length > previewN || capped.length > 8000;

  if (mode === "pager" && long && repoRoot) {
    const fullDisplay = isMd ? renderMarkdownTerminal(capped) : capped;
    const note = openPagerWithBody(fullDisplay, repoRoot, label);
    const head = `${ansi.green}read_file${ansi.reset} ${ansi.dim}${label}${ansi.reset} ${ansi.magenta}[pager]${ansi.reset}`;
    return `${head}\n${note}`;
  }

  let footer = "";
  let sourceSlice = capped;

  if (mode === "pager" && long && !repoRoot) {
    footer += `\n${ansi.dim}[pager 需要工作区路径，已改为终端全文]${ansi.reset}`;
  }

  if (mode === "collapsed" && long) {
    sourceSlice = lines.slice(0, previewN).join("\n");
    const restLines = lines.length - previewN;
    footer += `\n${ansi.dim}… 已折叠：还剩 ${restLines} 行 · ${ansi.cyan}/read expand${ansi.dim} 展开 · ${ansi.cyan}/read pager${ansi.dim} 分页${ansi.reset}`;
  }

  const rendered = isMd ? renderMarkdownTerminal(sourceSlice) : sourceSlice;
  const stateTag =
    mode === "collapsed" && long
      ? "预览"
      : long && (mode === "expanded" || mode === "pager")
        ? "全文"
        : "";
  const title = `read_file · ${label}${stateTag ? ` · ${stateTag}` : ""}${isMd ? " · md" : ""}`;
  return boxAnsiContent(title, rendered, {
    ...options,
    maxLines: mode === "collapsed" && long ? previewN + 40 : options.maxLines ?? 200,
    maxChars: mode === "collapsed" && long ? 80_000 : options.maxChars ?? 120_000,
  }) + footer;
}

/**
 * 工具回显：read_file 走专用格式；其余 JSON 排版后入框。
 */
export function formatToolLogPreview(toolName, output, options = {}) {
  if (toolName === "read_file") {
    const p = options.toolInput?.path ?? "";
    return formatReadFileDisplay(p, output, options);
  }

  const { maxLines = 24, maxChars = 12000 } = options;
  const body = prettifyIfJson(String(output));
  return boxAnsiContent(` ${toolName} `, body, { maxLines, maxChars });
}

/** Bash：高亮命令 + 框内输出 */
export function formatBashLog(command, output, options = {}) {
  return `${ansi.yellow}$ ${command}${ansi.reset}\n${boxAnsiContent("output", String(output), options)}`;
}
