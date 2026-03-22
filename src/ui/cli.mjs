/**
 * REPL：读用户输入、跑 agentLoop、打印助手回复（JSON 会尝试排版）。
 */
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  ansi,
  prettifyIfJson,
  formatToolLogPreview,
  displayWidth,
  READ_FILE_UI_HELP,
  setReadFileDisplayMode,
  describeReadFileDisplayMode,
} from "./terminal-fmt.mjs";

function printBanner({ minimal, repoRoot, model }) {
  const d = ansi.dim;
  const r = ansi.reset;
  const mode = minimal ? "shell-only" : "full";
  const modeHint = minimal
    ? "tools: bash"
    : "tools: files · bash · todo · task · skills · disk tasks · bg shell · team";

  const lines = [
    `${ansi.cyan}${ansi.bold} agents-node ${r}${d}·${r} ${ansi.magenta}${mode}${r}`,
    `${d}${modeHint}${r}`,
    `${d}workspace${r} ${repoRoot ?? "—"}`,
  ];
  if (model) {
    lines.push(`${d}model${r}     ${model}`);
  }
  lines.push(`${d}quit${r}      q · exit · Ctrl+C`);
  lines.push(`${d}read_file${r}  ${ansi.cyan}/read${r} ${d}折叠·全文·分页${r}`);

  const innerW = Math.max(
    36,
    ...lines.map((l) => displayWidth(l)),
  );
  const horiz = "─".repeat(innerW + 2);

  console.log();
  console.log(`${d}╭${horiz}╮${r}`);
  for (const line of lines) {
    const pad = Math.max(0, innerW - displayWidth(line));
    console.log(`${d}│${r} ${line}${" ".repeat(pad)} ${d}│${r}`);
  }
  console.log(`${d}╰${horiz}╯${r}`);
  console.log();
}

export function printAssistantText(content) {
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block.type === "text" && block.text) {
      const t = block.text.trim();
      const looksJson =
        (t.startsWith("{") && t.endsWith("}")) ||
        (t.startsWith("[") && t.endsWith("]"));
      if (looksJson) {
        const pretty = prettifyIfJson(block.text);
        if (pretty !== block.text) {
          console.log(formatToolLogPreview("assistant", pretty, { maxLines: 48 }));
          continue;
        }
      }
      process.stdout.write(block.text);
    }
  }
}

export async function runRepl({ agentLoop, minimal, repoRoot, model }) {
  printBanner({ minimal, repoRoot, model });

  const rl = readline.createInterface({ input, output });
  const history = [];

  try {
    while (true) {
      let query;
      try {
        query = await rl.question(`${ansi.cyan}›${ansi.reset} `);
      } catch {
        break;
      }
      const t = query.trim();
      if (!t || t.toLowerCase() === "q" || t.toLowerCase() === "exit") {
        break;
      }
      if (t.toLowerCase().startsWith("/read")) {
        const rest = t.slice(5).trim().toLowerCase();
        if (!rest || rest === "help" || rest === "?") {
          console.log(READ_FILE_UI_HELP);
        } else if (
          rest === "collapse" ||
          rest === "collapsed" ||
          rest === "close"
        ) {
          setReadFileDisplayMode("collapsed");
          console.log(`${ansi.dim}read_file UI →${ansi.reset} 折叠预览`);
        } else if (
          rest === "expand" ||
          rest === "expanded" ||
          rest === "open" ||
          rest === "full"
        ) {
          setReadFileDisplayMode("expanded");
          console.log(`${ansi.dim}read_file UI →${ansi.reset} 终端全文`);
        } else if (rest === "pager") {
          setReadFileDisplayMode("pager");
          console.log(`${ansi.dim}read_file UI →${ansi.reset} 分页器（less -R）`);
        } else if (rest === "reset") {
          setReadFileDisplayMode(null);
          console.log(`${ansi.dim}read_file UI →${ansi.reset} 已恢复环境变量`);
        } else if (rest === "status") {
          console.log(describeReadFileDisplayMode());
        } else {
          console.log(`${ansi.yellow}未知子命令。${ansi.reset} ${READ_FILE_UI_HELP}`);
        }
        console.log();
        continue;
      }
      history.push({ role: "user", content: t });
      await agentLoop(history);
      const last = history[history.length - 1]?.content;
      printAssistantText(last);
      console.log("\n");
    }
  } finally {
    rl.close();
  }
}
