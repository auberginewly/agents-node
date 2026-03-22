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

## 可选阅读

仓库内 **`LEARNING.md`** 把各模块按主题拆开说明，适合顺着读源码；不要求先读也能直接跑。
