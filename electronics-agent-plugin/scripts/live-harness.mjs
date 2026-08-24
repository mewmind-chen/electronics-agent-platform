#!/usr/bin/env node
/**
 * Live: DeepSeek Harness (plugin composition) → part_research → POST /v1/parts/research.
 * Does not print tokens. Writes tests/phase11/live-results.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { extractNamedTool } from "../../apps/agent-api/src/harness-dispatch.js";
import { resolveJsonrpcBin } from "../../apps/agent-api/src/agent-runtime.js";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(pluginRoot, "..");
const runtimeDir = join(repoRoot, "runtime");
const requireFromApi = createRequire(join(repoRoot, "apps/agent-api/package.json"));
const { DeepSeekHarness } = requireFromApi("@deepseek-ai/dsh-sdk-client");

const port = Number(process.env.AGENT_API_PORT || 18713);
const token = String(process.env.ELECTRONICS_AGENT_PLATFORM_TOKEN || "phase11-live-token").trim();
const startedApi = !process.env.AGENT_API_URL;
const url = String(process.env.AGENT_API_URL || `http://127.0.0.1:${port}`).replace(/\/+$/, "");

function timeout(ms, label) {
  const err = new Error(label || "timeout");
  err.code = "TIMEOUT";
  return err;
}

async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeout(ms, label)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitHealth(base, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("health timeout");
}

const evidence = {
  prompt: "分析 TPS54560DDAR",
  chain: [
    "DeepSeek Harness",
    "electronics-agent plugin",
    "part_research",
    "POST /v1/parts/research",
    "electronics-agent-platform",
  ],
  ok: false,
};

let child;
try {
  if (startedApi) {
    child = spawn(process.execPath, [join(repoRoot, "apps/agent-api/src/index.js")], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AGENT_API_HOST: "127.0.0.1",
        AGENT_API_PORT: String(port),
        AGENT_API_TOKEN: token,
        ELECTRONICS_IGNORE_LIVE: process.env.ELECTRONICS_IGNORE_LIVE || "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  await waitHealth(url);

  const bin = resolveJsonrpcBin();
  if (!bin) throw new Error("jsonrpc bin missing");
  const harness = new DeepSeekHarness({
    launch: {
      command: process.execPath,
      args: [bin, join(pluginRoot, "jsonrpc.cordis.yml")],
      cwd: pluginRoot,
      env: {
        ...process.env,
        NODE_PATH: join(runtimeDir, "node_modules"),
        AGENT_API_URL: url,
        ELECTRONICS_AGENT_PLATFORM_TOKEN: token,
        DSH_CWD: pluginRoot,
        DSH_SESSION_ROOT: join(tmpdir(), "electronics-agent-plugin-sessions"),
        DSH_SYSTEM_PROMPT:
          "You are the Electronics Agent. Load skill part-analysis. When the user asks to analyze an MPN, call part_research with that MPN copied verbatim. Return the tool JSON. Never write a database.",
      },
    },
    cwd: pluginRoot,
    provider: process.env.DSH_PROVIDER || "deepseek-official",
    model: process.env.DSH_MODEL || "deepseek-chat",
    maxTokens: 2048,
  });
  const result = await withTimeout(
    harness.run("分析 TPS54560DDAR", { sessionId: `phase11-${Date.now()}` }),
    120_000,
    "harness timeout",
  );
  await harness.close().catch(() => {});
  const extracted = extractNamedTool(result, "part_research");
  const value = extracted?.value || null;
  evidence.viaHarness = true;
  evidence.toolsCalled = extracted?.toolsCalled || [];
  evidence.mpn = value?.mpn || null;
  evidence.ok = Boolean(value && (value.ok !== false) && value.mpn === "TPS54560DDAR");
  evidence.error = evidence.ok ? "" : value?.error || "part_research missing";
} catch (err) {
  evidence.ok = false;
  evidence.error = err instanceof Error ? err.message : String(err);
} finally {
  if (child) child.kill("SIGTERM");
}

const outDir = join(repoRoot, "tests/phase11");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "live-results.json"), `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ok: evidence.ok, mpn: evidence.mpn || null, error: evidence.error || "" })}\n`);
process.exit(evidence.ok ? 0 : 2);
