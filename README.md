# agents-node

本地运行的 **Coding Agent** CLI：连兼容 Anthropic Messages API 的模型（含 Kimi / Moonshot 等），在固定工作区内用工具读写文件、跑 shell、拆子任务、记磁盘任务等。

## 需要

- Node.js 18+（推荐 20+）
- 根目录 `.env`：`MODEL_ID`、`ANTHROPIC_API_KEY`；若用 Kimi 等网关再加 `ANTHROPIC_BASE_URL`

## 安装与启动

```bash
npm install
npm start
```

- **`npm run agent:minimal`**：只开 `bash`，适合当「远程 shell 助手」试连通性。
- 退出：输入 `q` / `exit`，或 `Ctrl+C`。

## Web 演示（浏览器）

同一套 Agent 循环，通过 **HTTP + SSE** 推事件到 **React + Vite** 前端（聊天 + 工具侧栏）。

```bash
npm run build:web   # 首次或改完 web/src 后
npm run web
```

浏览器打开终端里提示的地址（默认 **http://127.0.0.1:3847/**）。静态资源优先读 **`web/dist/`**（由 `build:web` 生成）；未构建时终端会提示。开发时可双开：**终端 A** `npm run web`，**终端 B** `npm run web:dev`（Vite **5173**，`/api` 代理到本服务；代理目标可用 `VITE_API_ORIGIN` 覆盖）。需已配置 `.env`。端口：`WEB_PORT`。若 **3847 已被占用**，服务会自动试 3848、3849…；也可关掉旧进程：`lsof -ti :3847 | xargs kill`。

- `GET /api/health` — 返回 `model`、`repoRoot` 等（页面顶部信息）  
- `GET /api/suggestions` — 调用当前模型生成 3 条空会话示例问题（JSON）；失败时返回内置兜底。设 **`WEB_SUGGESTIONS_AI=0`** 可关闭模型调用、始终返回兜底（省 token / 离线）  
- `GET /api/sessions` — 会话列表摘要（`id`、`preview`、`messageCount`、`updatedAt`）  
- `GET /api/sessions/:id` — 指定会话的完整 `messages[]`（Anthropic 结构）  
- `DELETE /api/sessions/:id` — 删除会话（磁盘 + 内存）  
- `POST /api/chat` — body：`{ "message": "…", "sessionId": "可选 UUID" }`，响应为 **SSE**：`session` / **`assistant_delta`**（流式正文）/ `assistant`（整轮定稿）/ `tool_start` / `tool_end` / `log` / `done` / `error`  

**说明**：会话持久化在工作区 **`.web-sessions/<uuid>.json`**（已写入 `.gitignore`）；**刷新或重启 Node** 后前端会拉列表并恢复。客户端断开时服务端会 **Abort** 正在进行的模型流。环境变量 **`AGENT_STREAM=0`** 或 **`AGENT_NO_STREAM=1`** 可关闭流式、改回单次 `messages.create`（部分网关不兼容流式时用）。仅适合本机演示，勿直接暴露公网。  
助手气泡使用 **Markdown**（`marked` + `DOMPurify`，由 Vite 打包进前端）。

## 工作区

默认 **本仓库根目录** 就是沙箱（`read_file` / `write_file` / `bash` 的 `cwd` 等都以它为根）。  
若希望沙箱是上一级目录（例如 monorepo 根），在 `.env` 或 shell 里设：

```bash
AGENT_WORKSPACE=..
```

持久化数据目录（相对工作区）：`.tasks/`、`.transcripts/`、`.team/`、`skills/`（可选）。

## 终端

启动时会打印简要横幅（模式、工作区、当前模型）。工具返回若像 JSON 会自动缩进，并用浅色框包一层，方便和模型正文区分。

**`read_file`**：`.md` / `.mdx` 等会在终端里用 **Markdown → ANSI** 上色（`marked` + `marked-terminal`）。超长文件默认**折叠预览**（前 N 行），在 REPL 里可用：

- `/read` — 查看说明  
- `/read expand` — 终端内全文  
- `/read collapse` — 恢复折叠预览  
- `/read pager` — 用 `less -R`（或环境变量 `PAGER`）打开全文  

环境变量：`AGENT_READ_UI=collapsed|expanded|pager`、`AGENT_READ_PREVIEW_LINES`、`AGENT_READ_MD=0` 可关闭 MD 渲染。

## 脚本

| 命令 | 说明 |
|------|------|
| `npm start` / `npm run agent` | 全量工具 |
| `npm run agent:minimal` | 仅 bash |
| `npm run build:web` | 构建 Web 前端到 `web/dist/` |
| `npm run web:dev` | Vite 开发服（5173，代理 `/api`） |
| `npm run web` | Web UI + SSE（默认 3847 端口，读 `web/dist`） |

## 源码布局

| 目录 | 内容 |
|------|------|
| `src/core/` | 环境变量与工作区根、Anthropic 客户端 |
| `src/ui/` | REPL、终端格式化 |
| `src/agent/` | 主循环、子代理、上下文压缩 |
| `src/tools/` | 文件/bash 沙箱、工具 schema |
| `src/tasks/` | 会话 todo、磁盘任务、后台 shell |
| `src/skills/` | Skill 加载 |
| `src/team/` | 团队邮箱与队友循环 |
| `server/` | Web：`index.mjs` 静态托管 `web/dist`（或回退 `web/`）+ `/api/chat` SSE |
| `web/` | 演示前端：Vite + React（`web/src`） |

## 可选阅读

仓库内 **`LEARNING.md`** 把各模块按主题拆开说明，适合顺着读源码；不要求先读也能直接跑。
