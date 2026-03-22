# cli.mjs 架构分析文档

## 1. 概述

`cli.mjs` 是 agents-node 项目的命令行入口，负责初始化 Anthropic 客户端、配置工具集、启动交互式 REPL 会话，并协调整个 Agent 循环。

**文件位置**: `src/ui/cli.mjs`

## 2. 核心依赖

| 依赖 | 用途 |
|------|------|
| `@anthropic-ai/sdk` | Anthropic Claude API 客户端 |
| `chalk` | 终端彩色输出 |
| `readline/promises` | 交互式命令行读取 |
| `dotenv/config` | 环境变量加载 |

## 3. 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        cli.mjs                              │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Config     │  │   Client     │  │   Tool Registry  │  │
│  │   (env)      │  │  (Anthropic) │  │   (tools.mjs)    │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Agent Loop (loop.mjs)                    │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐  │  │
│  │  │   Pre-      │  │   LLM       │  │  Tool        │  │  │
│  │  │   process   │→ │   Call      │→ │  Execution   │  │  │
│  │  └─────────────┘  └─────────────┘  └──────────────┘  │  │
│  └──────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Subagent   │  │   Context    │  │   Background     │  │
│  │   (task)     │  │   Compact    │  │   Tasks          │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 4. 核心组件详解

### 4.1 初始化流程

```javascript
// 1. 加载环境变量
import "dotenv/config";

// 2. 创建 Anthropic 客户端
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// 3. 配置模型参数
const MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";
const MAX_TURNS = 100;
const TOKEN_THRESHOLD = 50000;

// 4. 初始化消息历史
let messages = [];
```

### 4.2 工具系统 (tools.mjs)

| 类别 | 工具 | 功能描述 |
|------|------|----------|
| **文件操作** | `bash` | 执行 shell 命令 |
| | `read_file` | 读取文件内容 |
| | `write_file` | 写入文件内容 |
| | `edit_file` | 替换文件文本 |
| **任务管理** | `todo` | 更新任务列表（会话级） |
| | `task_create` | 创建持久化任务 |
| | `task_update` | 更新任务状态 |
| | `task_list` | 列出所有任务 |
| | `task_get` | 获取任务详情 |
| **智能体** | `task` | 生成子智能体（独立上下文） |
| | `load_skill` | 加载专业技能 |
| **上下文** | `compact` | 手动触发对话压缩 |
| **后台** | `background_run` | 后台执行命令 |
| | `check_background` | 检查后台任务 |
| **团队** | `spawn_teammate` | 生成持久队友 |
| | `list_teammates` | 列出队友 |
| | `send_message` | 发送消息给队友 |
| | `read_inbox` | 读取收件箱 |
| | `broadcast` | 广播消息 |

### 4.3 Agent 循环 (loop.mjs)

```
用户输入 → 预处理 → LLM 调用 → 工具执行 → 结果反馈 → 循环/结束
```

**关键特性**:
- **最大轮次限制**: 防止无限循环
- **工具结果截断**: 限制 50000 字符
- **错误处理**: 工具执行异常捕获

### 4.4 上下文压缩 (context-compact.mjs)

三层压缩策略：

| 层级 | 触发条件 | 处理方式 |
|------|----------|----------|
| **Micro** | 每次循环 | 旧 tool_result 改为占位符 |
| **Auto** | token > 50k | 落盘 + 模型摘要 |
| **Manual** | 用户调用 `compact` | 同上 |

### 4.5 子智能体 (subagent.mjs)

- **独立消息上下文**: 不继承父对话历史
- **受限工具集**: 仅 `CHILD_TOOLS`（无 `task`，避免递归）
- **结果摘要**: 仅返回最终文本摘要

## 5. 系统提示词 (System Prompt)

```
角色: 编码智能体 + 团队负责人
工作目录: /Users/aubergine/WorkSpace/fe-projects/agents-node

规划: 使用 todo 工具（会话级）或 task_create/task_update（持久化）
知识: 使用 load_skill 加载技能
委托: task 用于一次性子代理，spawn_teammate 用于持久队友
执行: background_run 用于长命令
上下文: compact 用于手动压缩
```

## 6. 交互式命令

| 命令 | 功能 |
|------|------|
| `exit` / `quit` | 退出程序 |
| `clear` | 清空消息历史 |
| 其他输入 | 发送给 Agent 处理 |

## 7. 目录结构

```
agents-node/
├── src/
│   ├── ui/
│   │   ├── cli.mjs           # CLI 入口
│   │   └── terminal-fmt.mjs  # 终端格式化
│   ├── agent/
│   │   ├── loop.mjs          # Agent 循环
│   │   ├── subagent.mjs      # 子智能体
│   │   └── context-compact.mjs # 上下文压缩
│   ├── tools/
│   │   ├── tools.mjs         # 工具实现
│   │   └── tool-schemas.mjs  # 工具 Schema
│   └── team/
│       └── team.mjs          # 团队协作
├── .tasks/                   # 持久化任务存储
├── .team/
│   └── inbox/                # 团队消息收件箱
├── transcripts/              # 对话转录存档
└── agent.mjs                 # 主入口（代理 cli.mjs）
```

## 8. 关键设计决策

### 8.1 工具权限分离
- **子智能体**: 仅基础工具（bash, read, write, edit）
- **父智能体**: 完整工具集（含 task, spawn_teammate 等）
- **目的**: 防止递归爆炸，控制权限边界

### 8.2 上下文管理
- **Micro 压缩**: 高频低损，保持最近 3 条 tool_result
- **Auto 压缩**: 阈值触发，落盘 + 摘要
- **持久化**: 转录文件保存完整历史

### 8.3 团队协作
- **Mailbox 模式**: `.team/inbox/{name}.jsonl`
- **消息类型**: message, broadcast, shutdown_request/response, plan_approval_response
- **状态追踪**: teammates 列表维护状态

## 9. 扩展点

| 扩展 | 方式 |
|------|------|
| 新增工具 | 在 `tool-schemas.mjs` 定义 schema，在 `tools.mjs` 实现 handler |
| 新增技能 | 创建 skill 文件，通过 `load_skill` 加载 |
| 自定义模型 | 设置 `ANTHROPIC_MODEL` 环境变量 |
| 调整阈值 | 修改 `TOKEN_THRESHOLD` 常量 |

## 10. 使用示例

```bash
# 启动 CLI
node agent.mjs

# 或使用 cli.mjs 直接
node src/ui/cli.mjs
```

## 11. 注意事项

1. **API Key**: 需要设置 `ANTHROPIC_API_KEY` 环境变量
2. **Token 限制**: 注意长对话会自动触发压缩
3. **后台任务**: 使用 `background_run` 避免阻塞主循环
4. **任务依赖**: 使用 `task_update` 的 `addBlockedBy`/`addBlocks` 管理依赖

---

*文档生成时间: 2025-01-XX*
*分析工具: Claude Code*
