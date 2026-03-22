#!/usr/bin/env node
/**
 * CLI 入口：交互式 coding agent。
 *
 *   node agent.mjs              默认全量工具
 *   node agent.mjs --minimal    仅 bash
 *   node agent.mjs --help
 *
 * 工作区见 REPO_ROOT（默认本包根目录）；父目录为沙箱时设 AGENT_WORKSPACE=..。
 */
import { loadEnv, requireModelId, createClient, REPO_ROOT } from "./src/core/config.mjs";
import { createAgentRuntime } from "./src/agent/loop.mjs";
import { runRepl } from "./src/ui/cli.mjs";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`用法:
  node agent.mjs              全量工具（文件、bash、任务、子代理、skills、后台 shell、团队邮箱等）
  node agent.mjs --minimal    仅 bash
  AGENT_MINIMAL=1 node agent.mjs

环境变量（.env）: MODEL_ID, ANTHROPIC_API_KEY, 可选 ANTHROPIC_BASE_URL；可选 AGENT_WORKSPACE
`);
  process.exit(0);
}

loadEnv();
const model = requireModelId();
const minimal =
  process.argv.includes("--minimal") || process.env.AGENT_MINIMAL === "1";

const client = createClient();
const { agentLoop } = createAgentRuntime({
  client,
  model,
  repoRoot: REPO_ROOT,
  minimal,
});

await runRepl({ agentLoop, minimal, repoRoot: REPO_ROOT, model });
