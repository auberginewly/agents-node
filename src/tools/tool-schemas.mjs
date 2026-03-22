/** Anthropic tools 的 input_schema 定义（与 Python agents 对齐） */
import { VALID_MSG_TYPES } from "../team/team.mjs";

export const SCHEMA_BASH = {
  name: "bash",
  description: "Run a shell command.",
  input_schema: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
};

export const SCHEMA_READ = {
  name: "read_file",
  description: "Read file contents.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string" },
      limit: { type: "integer" },
    },
    required: ["path"],
  },
};

export const SCHEMA_WRITE = {
  name: "write_file",
  description: "Write content to file.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
};

export const SCHEMA_EDIT = {
  name: "edit_file",
  description: "Replace exact text in file.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string" },
      old_text: { type: "string" },
      new_text: { type: "string" },
    },
    required: ["path", "old_text", "new_text"],
  },
};

export const SCHEMA_TODO = {
  name: "todo",
  description: "Update task list. Track progress on multi-step tasks.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            text: { type: "string" },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "completed"],
            },
          },
          required: ["id", "text", "status"],
        },
      },
    },
    required: ["items"],
  },
};

export const SCHEMA_TASK = {
  name: "task",
  description:
    "Spawn a subagent with fresh context. It shares the filesystem but not conversation history.",
  input_schema: {
    type: "object",
    properties: {
      prompt: { type: "string" },
      description: {
        type: "string",
        description: "Short description of the task",
      },
    },
    required: ["prompt"],
  },
};

export const SCHEMA_LOAD_SKILL = {
  name: "load_skill",
  description: "Load specialized knowledge by name.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Skill name to load" },
    },
    required: ["name"],
  },
};

export const SCHEMA_COMPACT = {
  name: "compact",
  description: "Trigger manual conversation compression.",
  input_schema: {
    type: "object",
    properties: {
      focus: { type: "string", description: "What to preserve in the summary" },
    },
  },
};

/** s07 持久化任务 */
export const SCHEMA_TASK_CREATE = {
  name: "task_create",
  description: "Create a new task.",
  input_schema: {
    type: "object",
    properties: {
      subject: { type: "string" },
      description: { type: "string" },
    },
    required: ["subject"],
  },
};

export const SCHEMA_TASK_UPDATE = {
  name: "task_update",
  description: "Update a task's status or dependencies.",
  input_schema: {
    type: "object",
    properties: {
      task_id: { type: "integer" },
      status: {
        type: "string",
        enum: ["pending", "in_progress", "completed"],
      },
      addBlockedBy: {
        type: "array",
        items: { type: "integer" },
      },
      addBlocks: {
        type: "array",
        items: { type: "integer" },
      },
    },
    required: ["task_id"],
  },
};

export const SCHEMA_TASK_LIST = {
  name: "task_list",
  description: "List all tasks with status summary.",
  input_schema: { type: "object", properties: {} },
};

export const SCHEMA_TASK_GET = {
  name: "task_get",
  description: "Get full details of a task by ID.",
  input_schema: {
    type: "object",
    properties: { task_id: { type: "integer" } },
    required: ["task_id"],
  },
};

/** s08 后台命令 */
export const SCHEMA_BACKGROUND_RUN = {
  name: "background_run",
  description:
    "Run command in background. Returns task_id immediately; completion appears in <background-results>.",
  input_schema: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
};

export const SCHEMA_CHECK_BACKGROUND = {
  name: "check_background",
  description: "Check background task status. Omit task_id to list all.",
  input_schema: {
    type: "object",
    properties: { task_id: { type: "string" } },
  },
};

/** s09 团队 */
export const SCHEMA_SPAWN_TEAMMATE = {
  name: "spawn_teammate",
  description: "Spawn a persistent teammate that runs its own agent loop.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      role: { type: "string" },
      prompt: { type: "string" },
    },
    required: ["name", "role", "prompt"],
  },
};

export const SCHEMA_LIST_TEAMMATES = {
  name: "list_teammates",
  description: "List all teammates with name, role, status.",
  input_schema: { type: "object", properties: {} },
};

export const SCHEMA_SEND_MESSAGE = {
  name: "send_message",
  description: "Send a message to a teammate's inbox (from lead).",
  input_schema: {
    type: "object",
    properties: {
      to: { type: "string" },
      content: { type: "string" },
      msg_type: { type: "string", enum: [...VALID_MSG_TYPES] },
    },
    required: ["to", "content"],
  },
};

export const SCHEMA_READ_INBOX_LEAD = {
  name: "read_inbox",
  description: "Read and drain the lead's inbox.",
  input_schema: { type: "object", properties: {} },
};

export const SCHEMA_BROADCAST = {
  name: "broadcast",
  description: "Send a message to all teammates.",
  input_schema: {
    type: "object",
    properties: { content: { type: "string" } },
    required: ["content"],
  },
};

export const CHILD_TOOLS = [
  SCHEMA_BASH,
  SCHEMA_READ,
  SCHEMA_WRITE,
  SCHEMA_EDIT,
];

export const PARENT_TOOLS_FULL = [
  ...CHILD_TOOLS,
  SCHEMA_TODO,
  SCHEMA_TASK,
  SCHEMA_LOAD_SKILL,
  SCHEMA_COMPACT,
  SCHEMA_TASK_CREATE,
  SCHEMA_TASK_UPDATE,
  SCHEMA_TASK_LIST,
  SCHEMA_TASK_GET,
  SCHEMA_BACKGROUND_RUN,
  SCHEMA_CHECK_BACKGROUND,
  SCHEMA_SPAWN_TEAMMATE,
  SCHEMA_LIST_TEAMMATES,
  SCHEMA_SEND_MESSAGE,
  SCHEMA_READ_INBOX_LEAD,
  SCHEMA_BROADCAST,
];
