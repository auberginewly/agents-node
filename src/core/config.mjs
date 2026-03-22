/**
 * 环境变量、工作区根目录、Anthropic 客户端。
 * REPO_ROOT 默认 = 本包根目录；要换沙箱根目录用 AGENT_WORKSPACE（相对或绝对路径）。
 */
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 仓库根（含 package.json、agent.mjs） */
export const PKG_ROOT = join(__dirname, "..", "..");

// 在解析 REPO_ROOT 之前读入 .env，使 AGENT_WORKSPACE 可写在文件中；上一级 .env 仍可作为 MODEL_ID 等变量的来源
dotenv.config({ path: join(PKG_ROOT, ".env"), override: true });
dotenv.config({ path: join(PKG_ROOT, "..", ".env"), override: false });

function resolveRepoRoot() {
  const raw = process.env.AGENT_WORKSPACE?.trim();
  if (!raw) return PKG_ROOT;
  return resolve(PKG_ROOT, raw);
}

/** 工作区根：文件、bash cwd、skills/、.tasks/、.transcripts/、.team/ 均相对此目录 */
export const REPO_ROOT = resolveRepoRoot();

export function loadEnv() {
  dotenv.config({ path: join(REPO_ROOT, ".env"), override: true });
  dotenv.config({ path: join(PKG_ROOT, ".env"), override: false });
  if (process.env.ANTHROPIC_BASE_URL) {
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  }
}

export function requireModelId() {
  const m = process.env.MODEL_ID;
  if (!m) {
    console.error("缺少环境变量 MODEL_ID（见本目录或 AGENT_WORKSPACE 对应目录下的 .env / .env.example）");
    process.exit(1);
  }
  return m;
}

export function createClient() {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
  });
}
