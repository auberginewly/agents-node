# agents-node 项目源代码分析报告

## 1. 项目概述

**agents-node** 是一个基于 Node.js 和 Anthropic Claude API 的智能代码代理系统。该项目实现了一个多功能的 AI 编码助手，支持文件操作、任务管理、团队协作、后台执行等高级特性。

### 核心特性
- **文件系统操作**: 安全的文件读写、编辑和 bash 命令执行
- **任务管理**: 持久化任务系统，支持任务依赖关系
- **团队协作**: 多智能体协作，支持消息传递和团队邮箱
- **上下文压缩**: 三层压缩机制管理长对话
- **技能加载**: 动态加载专业技能文档
- **后台执行**: 非阻塞的后台任务执行
- **子智能体**: 支持委派任务给子代理

### 技术栈
- **运行时**: Node.js (ES Modules)
- **AI 模型**: Anthropic Claude API
- **依赖**: `@anthropic-ai/sdk`, `dotenv`

---

## 2. 目录结构树

（按功能分子目录；下文「文件名」均相对 `src/`。）

```
src/
├── core/
│   └── config.mjs              # 配置、REPO_ROOT、Anthropic 客户端
├── ui/
│   ├── cli.mjs                 # REPL
│   └── terminal-fmt.mjs        # 终端框线与 JSON 排版
├── agent/
│   ├── loop.mjs                # 主循环 (s01–s09 整合)
│   ├── subagent.mjs            # 子智能体 (s04)
│   └── context-compact.mjs     # 上下文压缩 (s06)
├── tools/
│   ├── tools.mjs               # 文件与 bash 沙箱 (s02)
│   └── tool-schemas.mjs        # 工具 JSON Schema
├── tasks/
│   ├── todo-manager.mjs        # 会话 todo (s03)
│   ├── task-manager.mjs        # 磁盘任务 (s07)
│   └── background-manager.mjs  # 后台 shell (s08)
├── skills/
│   └── skill-loader.mjs        # Skill 加载 (s05)
└── team/
    └── team.mjs                # 团队邮箱与队友 (s09)
```

---

## 3. 文件清单

### 3.1 按类型分类

| 类别 | 说明 |
|------|------|
| JavaScript Module (.mjs) | 见上表各路径 |

### 3.2 详细文件列表

| 路径（相对 `src/`） | 主要功能 |
|---------------------|----------|
| `agent/loop.mjs` | 主代理循环，整合所有功能模块 |
| `team/team.mjs` | 团队协作、消息总线、队友管理 |
| `tools/tool-schemas.mjs` | 所有工具的 JSON Schema 定义 |
| `agent/context-compact.mjs` | 三层上下文压缩机制 |
| `tasks/task-manager.mjs` | 持久化任务管理，支持依赖关系 |
| `tools/tools.mjs` | 文件系统操作和 bash 执行 |
| `tasks/background-manager.mjs` | 后台任务执行管理 |
| `skills/skill-loader.mjs` | 技能文档加载和解析 |
| `core/config.mjs` | 配置管理和 Anthropic 客户端创建 |
| `agent/subagent.mjs` | 子智能体实现 |
| `tasks/todo-manager.mjs` | 待办事项管理 |
| `ui/cli.mjs` | REPL 命令行界面 |
| `ui/terminal-fmt.mjs` | 终端输出格式化 |

**说明**: 字节数与旧版平铺结构不同步时，以仓库内实际文件为准。

---

## 4. 关键文件功能说明

### 4.1 loop.mjs - 主代理循环
**核心功能**: 整合 s01-s09 所有功能的主控制循环

**主要组件**:
- `buildSystemPrompt()`: 构建系统提示词，支持 minimal 和 full 模式
- `createAgentRuntime()`: 创建代理运行时环境
- `agentLoop()`: 主循环，处理模型交互和工具调用

**支持的 Tools** (按阶段):
- **s01 (基础)**: bash, read_file, write_file, edit_file
- **s03 (待办)**: todo
- **s04 (子代理)**: task
- **s05 (技能)**: load_skill
- **s06 (压缩)**: compact
- **s07 (任务)**: task_create, task_update, task_list, task_get
- **s08 (后台)**: background_run, check_background
- **s09 (团队)**: spawn_teammate, list_teammates, send_message, read_inbox, broadcast

**特殊机制**:
- 自动上下文压缩 (microCompact + autoCompact)
- 后台任务通知注入
- 收件箱消息注入
- Todo 提醒机制

---

### 4.2 team.mjs - 团队协作系统
**核心功能**: 实现多智能体协作的消息总线和队友管理

**主要类**:
- `MessageBus`: JSONL 格式的消息总线
  - `send()`: 发送消息到指定收件箱
  - `readInbox()`: 读取并清空收件箱
  - `broadcast()`: 广播消息给所有队友

**消息类型**:
```javascript
VALID_MSG_TYPES = [
  "message",           // 普通消息
  "broadcast",         // 广播
  "shutdown_request",  // 关闭请求
  "shutdown_response", // 关闭响应
  "plan_approval_response" // 计划审批响应
]
```

**队友管理**:
- `createTeammateManager()`: 创建队友管理器
- `spawn()`: 创建新队友
- `listAll()`: 列出所有队友状态
- `teammateLoop()`: 队友独立运行循环

**队友工具集**:
- bash, read_file, write_file, edit_file
- send_message, read_inbox

---

### 4.3 tool-schemas.mjs - 工具 Schema 定义
**核心功能**: 定义所有可用工具的 JSON Schema，供 Anthropic API 使用

**工具分类**:

| 类别 | 工具 |
|------|------|
| **基础工具** | bash, read_file, write_file, edit_file |
| **会话管理** | todo, compact |
| **子代理** | task |
| **技能** | load_skill |
| **任务管理** | task_create, task_update, task_list, task_get |
| **后台执行** | background_run, check_background |
| **团队协作** | spawn_teammate, list_teammates, send_message, read_inbox, broadcast |

**导出常量**:
- `CHILD_TOOLS`: 子代理可用工具（基础4个）
- `PARENT_TOOLS_FULL`: 父代理完整工具集（全部20个）

---

### 4.4 context-compact.mjs - 上下文压缩
**核心功能**: 三层压缩机制管理长对话上下文

**三层压缩**:

1. **Micro Compact (Layer 1)**:
   - 保留最近 3 条 tool_result 全文
   - 更早的替换为占位符 `[Previous: used {tool_name}]`
   - 由 `microCompact()` 实现

2. **Auto Compact (Layer 2/3)**:
   - 当 token 数超过 50,000 时触发
   - 保存完整对话到 `.transcripts/transcript_{timestamp}.jsonl`
   - 调用模型生成摘要
   - 用摘要替换原对话历史
   - 由 `autoCompact()` 实现

3. **Manual Compact**:
   - 通过 `compact` 工具手动触发

**Token 估算**:
```javascript
estimateTokens(messages) = Math.floor(JSON.stringify(messages).length / 4)
```

---

### 4.5 task-manager.mjs - 任务管理
**核心功能**: 持久化任务管理，支持任务依赖关系

**任务结构**:
```javascript
{
  id: number,
  subject: string,
  description: string,
  status: "pending" | "in_progress" | "completed",
  blockedBy: number[],  // 被哪些任务阻塞
  blocks: number[],     // 阻塞哪些任务
  owner: string
}
```

**存储格式**:
- 位置: `.tasks/task_{id}.json`
- 格式: JSON 文件

**主要方法**:
- `create()`: 创建新任务
- `get()`: 获取任务详情
- `update()`: 更新任务状态和依赖
- `listAll()`: 列出所有任务（带状态标记）
- `_clearDependency()`: 清理已完成任务的依赖

---

### 4.6 tools.mjs - 文件系统工具
**核心功能**: 安全的文件系统操作和 bash 执行

**安全机制**:
- `safePath()`: 路径安全检查，防止目录遍历攻击
- 危险命令拦截: `rm -rf /`, `sudo`, `shutdown`, `reboot` 等

**工具函数**:
- `runBash()`: 执行 shell 命令（120秒超时）
- `runRead()`: 读取文件内容（支持行数限制）
- `runWrite()`: 写入文件（自动创建目录）
- `runEdit()`: 文本替换编辑

**导出**:
- `createFilesystemTools(repoRoot)`: 创建工具集实例

---

### 4.7 background-manager.mjs - 后台任务管理
**核心功能**: 非阻塞的后台命令执行

**特性**:
- 使用 `child_process.exec` 异步执行
- 300秒超时
- 50MB 输出缓冲区
- 任务状态跟踪: running, completed, error, timeout

**主要方法**:
- `run(command)`: 启动后台任务，返回 task_id
- `check(taskId)`: 查询任务状态
- `drainNotifications()`: 获取并清空通知队列

**通知机制**:
- 任务完成后自动加入通知队列
- 主循环在每次 LLM 调用前注入通知

---

### 4.8 skill-loader.mjs - 技能加载器
**核心功能**: 动态加载专业技能文档

**技能文件格式**:
```markdown
---
name: skill-name
description: 技能描述
tags: tag1, tag2
---
技能详细内容...
```

**主要方法**:
- `getDescriptions()`: 获取所有技能摘要（用于 system prompt）
- `getContent(name)`: 获取指定技能的完整内容

**扫描规则**:
- 扫描 `skills/` 目录及其子目录
- 查找 `SKILL.md` 文件
- 解析 YAML frontmatter

---

### 4.9 config.mjs - 配置管理
**核心功能**: 环境变量管理和 Anthropic 客户端创建

**关键配置**:
- `PKG_ROOT`: 包目录
- `REPO_ROOT`: 工作区根目录（可通过 `AGENT_WORKSPACE` 环境变量自定义）
- `MODEL_ID`: 模型 ID（必需）
- `ANTHROPIC_API_KEY`: API 密钥
- `ANTHROPIC_BASE_URL`: 可选的自定义 base URL

**主要导出**:
- `loadEnv()`: 加载环境变量
- `requireModelId()`: 验证并返回模型 ID
- `createClient()`: 创建 Anthropic 客户端

---

### 4.10 subagent.mjs - 子智能体
**核心功能**: 实现任务委派给子代理

**特性**:
- 独立的 message 历史
- 仅使用 CHILD_TOOLS（避免递归）
- 最大 30 轮对话
- 返回最终文本摘要

**导出**:
- `createRunSubagent()`: 创建子代理运行器

---

### 4.11 todo-manager.mjs - 待办管理
**核心功能**: 会话内的待办事项管理

**特性**:
- 最多 20 个待办项
- 同时只能有一个 `in_progress` 状态
- 状态: pending, in_progress, completed

**主要方法**:
- `update(items)`: 更新待办列表
- `render()`: 渲染待办列表为文本

---

### 4.12 cli.mjs - 命令行界面
**核心功能**: REPL 交互界面

**特性**:
- 彩色提示符
- 支持 `q` 或 `exit` 退出
- 打印助手回复文本
- 显示当前模式（minimal/full）

**导出**:
- `runRepl()`: 启动 REPL
- `printAssistantText()`: 打印助手文本回复

---

## 5. 数据存储结构

项目使用以下目录存储数据（相对于 `REPO_ROOT`）:

| 目录 | 用途 | 文件格式 |
|------|------|----------|
| `.tasks/` | 持久化任务 | `task_{id}.json` |
| `.transcripts/` | 压缩后的对话记录 | `transcript_{timestamp}.jsonl` |
| `.team/` | 团队配置和消息 | `config.json`, `inbox/{name}.jsonl` |
| `skills/` | 技能文档 | `SKILL.md` |

---

## 6. 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        CLI (cli.mjs)                        │
│                      REPL 交互界面                          │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                    Agent Loop (loop.mjs)                    │
│              主循环 - 整合所有功能模块                      │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │  Tools  │ │   Todo  │ │  Task   │ │  Team   │           │
│  │(tools)  │ │(todo)   │ │(task)   │ │(team)   │           │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘           │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │  Skill  │ │ Context │ │Background│ │Subagent │           │
│  │(skill)  │ │(compact)│ │ (bg)    │ │ (task)  │           │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘           │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│              Anthropic API (config.mjs)                     │
│                   Claude 模型交互                           │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. 总结

agents-node 是一个功能完善的 AI 编码代理系统，采用模块化设计，每个 `.mjs` 文件负责特定的功能领域：

1. **基础层**: tools.mjs, config.mjs - 提供基础设施
2. **核心层**: loop.mjs - 主控制逻辑
3. **功能层**: todo, task, skill, background, team, subagent - 具体功能实现
4. **支持层**: context-compact, tool-schemas - 辅助功能
5. **接口层**: cli.mjs - 用户交互

项目采用渐进式功能设计（s01-s09），支持从简单的 bash-only 模式到完整的多智能体协作模式。

---

*文档生成时间: 2025年*
*分析路径: /Users/aubergine/WorkSpace/fe-projects/agents-node/src*
