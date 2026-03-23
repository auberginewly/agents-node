# 学习指南（LEARNING）

本仓库 **agents-node** 是一条 **Anthropic Messages 风格** 的本地 Agent CLI：循环里接模型、执行工具、写回 `tool_result`。下文按 **s01–s09** 主题编号，方便和常见「Agent 教程」章节对照；**不要求**本仓库里存在 `docs/zh/` 等外部目录。

## 开始之前

| 项目 | 说明 |
|------|------|
| 入口 | 根目录 `agent.mjs`；`npm start` 等价于 `node agent.mjs` |
| 配置 | `src/core/config.mjs` 读 `.env`：`MODEL_ID`、`ANTHROPIC_API_KEY`，可选 `ANTHROPIC_BASE_URL`、`AGENT_WORKSPACE` |
| 工作区 | **`REPO_ROOT`** 默认 = 本仓库根目录；换沙箱根目录见 **README** |
| 源码分包 | `src/core/` · `src/ui/` · `src/agent/` · `src/tools/` · `src/tasks/` · `src/skills/` · `src/team/` |
| `read_file` 终端 | 默认超长折叠预览；`/read expand` · `/read pager` · `/read collapse`；`.md` 走 Markdown→ANSI（`src/ui/terminal-fmt.mjs`） |
| Web 演示 | `npm run build:web` 后 `npm run web` → `server/index.mjs` 托管 `web/dist`；会话落盘 `.web-sessions/`；SSE 含 `assistant_delta` 流式与 `assistant` 定稿（`loop.mjs` 中 `client.messages.stream` + `eventSink`） |

---

## s01 — Agent 循环（The Agent Loop）

- **要点**：反复「请求模型 → 若 `stop_reason === "tool_use"` 则执行工具 → 用 `tool_result` 写回 `messages` → 再请求」，直到不再要工具。
- **代码**：`src/agent/loop.mjs` 中 `while (true)`；`src/ui/cli.mjs` 把用户输入推进 `history` 并调用 `agentLoop`。
- **终端**：`src/ui/terminal-fmt.mjs` 负责工具回显的 JSON 缩进与框线（与循环逻辑无关，仅展示层）。
- **练习**：`npm run agent:minimal` 只注册 **bash**，便于单独观察循环。

---

## s02 — Tool Use（工具分发）

- **要点**：用 **`parentHandlers` 映射**按工具名分发；读写走专用工具；路径经 **`safePath`** 限制在工作区内。
- **代码**：`src/tools/tools.mjs`、`src/tools/tool-schemas.mjs`、`src/agent/loop.mjs`（`parentHandlers` 组装）。
- **工作区**：`REPO_ROOT` 默认即本仓库根；嵌套在 monorepo 子目录且要以父目录为沙箱时设 **`AGENT_WORKSPACE=..`**。

---

## s03 — TodoWrite（会话规划）

- **要点**：**`todo` 工具**维护会话内步骤；连续多轮未更新会插入 **`<reminder>`**（实现上放在本轮所有 `tool_result` **之后**，避免与工具配对冲突）。
- **代码**：`src/tasks/todo-manager.mjs`；`src/agent/loop.mjs` 中 `roundsSinceTodo`。

---

## s04 — Subagents（子智能体）

- **要点**：**`task` 工具**开独立 `messages` 子循环，只把摘要回传；子循环工具集为 **`CHILD_TOOLS`**（不含 `task`，避免递归）。
- **代码**：`src/agent/subagent.mjs`；`src/tools/tool-schemas.mjs` 中 `CHILD_TOOLS` / `PARENT_TOOLS_FULL`。

---

## s05 — Skills（按需加载知识）

- **要点**：**Layer1** 进 system；**`load_skill`** 把全文放进 **tool_result**（Layer2）。
- **代码**：`src/skills/skill-loader.mjs`；工作区下 `skills/**/SKILL.md`。

---

## s06 — Context Compact（上下文压缩）

- **要点**：**micro** 压缩较早的 `tool_result` 正文；**auto** 超阈值则落盘 `.transcripts` 并摘要替换历史；**`compact` 工具**走同一套摘要逻辑。
- **代码**：`src/agent/context-compact.mjs`；`src/agent/loop.mjs` 在 `messages.create` 前的顺序（压缩 → 注入 → 请求）。

---

## s07 — Task System（磁盘任务）

- **要点**：跨轮次持久化在 **`.tasks/task_N.json`**；**blockedBy / blocks**；与 s04 的 **`task` 子智能体**不同名，勿混。
- **代码**：`src/tasks/task-manager.mjs`；工具名 **`task_create` / `task_update` / `task_list` / `task_get`**。

---

## s08 — Background Tasks（后台命令）

- **要点**：**`background_run`** 返回 `task_id`；完成后进入通知队列；主循环在下一轮请求前把通知 **合并进最后一条 `user` 内容**（与单独多插一条 `user` 相比，更兼容部分网关对「工具配对」的校验）。
- **代码**：`src/tasks/background-manager.mjs`；`src/agent/loop.mjs` 的 `injectPreLlmHooks`；**`check_background`**。

---

## s09 — Agent Teams（团队邮箱）

- **要点**：**`.team/inbox/*.jsonl`**；**`spawn_teammate`** 后台跑队友循环；Lead 侧工具见 `tool-schemas`。
- **代码**：`src/team/team.mjs`（`MessageBus`、`createTeammateManager`）；`injectPreLlmHooks` 同样把收件箱内容 **合并进最后一条 `user`**。

---

## 目录结构（速查）

| 路径 | 作用 |
|------|------|
| `agent.mjs` | 入口 |
| `src/core/config.mjs` | `REPO_ROOT`、`.env`、客户端 |
| `src/tools/tools.mjs` | 文件与 bash 沙箱 |
| `src/tools/tool-schemas.mjs` | 全部工具 schema |
| `src/tasks/todo-manager.mjs` | s03 |
| `src/agent/subagent.mjs` | s04 |
| `src/skills/skill-loader.mjs` | s05 |
| `src/agent/context-compact.mjs` | s06 |
| `src/tasks/task-manager.mjs` | s07 |
| `src/tasks/background-manager.mjs` | s08 |
| `src/team/team.mjs` | s09 |
| `src/agent/loop.mjs` | 主循环与钩子 |
| `src/ui/cli.mjs` | REPL |
| `src/ui/terminal-fmt.mjs` | 终端框线与 JSON 排版 |

**`minimal` 模式**：只保留 **bash**（相当于只开 s01 级工具链），并关闭与 s08/s09 相关的注入逻辑。

**建议阅读顺序**：先扫本文件 → 按需打开上表路径 → 最后通读 **`src/agent/loop.mjs`** 串起数据流。
