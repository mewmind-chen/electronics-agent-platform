/**
 * Live Model Qualification.
 * Walks Router → official DeepSeekHarness → electronics Skill/Tool.
 * Writes tests/phase82/live-results.json. Never prints secrets.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL_CANDIDATES, providerBindings } from "../packages/model-policy/src/index.js";
import { extractNamedTool } from "../apps/agent-api/src/harness-dispatch.js";
import { CORDIS_PATH, processReady, resolveJsonrpcBin } from "../apps/agent-api/src/agent-runtime.js";

const requireFromApi = createRequire(join(dirname(fileURLToPath(import.meta.url)), "../apps/agent-api/package.json"));
const { DeepSeekHarness } = requireFromApi("@deepseek-ai/dsh-sdk-client");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIRST_BATCH = (process.env.QUALIFY_ONLY || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .concat(
    process.env.QUALIFY_ONLY
      ? []
      : [
          "opencode-go/deepseek-v4-flash",
          "litellm/free-fast",
          "opencode-go/deepseek-v4-pro",
          "opencode-go/qwen3.7-max",
          "litellm/free-strong",
          "opencode-go/kimi-k3",
          "litellm/free-long",
          "subscriptions/grok-4.6",
          "describe-image/glm-4v-flash",
        ],
  );

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

function scoreCaps(checks) {
  const caps = {
    json: checks.json ? "pass" : "fail",
    toolCalling: checks.tool ? "pass" : "fail",
    structuredLong: checks.long ? "pass" : "fail",
    harness: checks.harness ? "pass" : "fail",
    vision: checks.vision === undefined ? "n/a" : checks.vision ? "pass" : "fail",
  };
  return caps;
}

async function smokeOne(entry, binding) {
  const started = Date.now();
  const out = {
    id: entry.id,
    providerId: binding.providerId,
    model: binding.model,
    availability: binding.availability,
    auth: binding.auth,
    verified: false,
    pool: "candidate",
    capabilities: scoreCaps({}),
    failureReason: "",
    notes: "",
    checks: {},
  };
  if (binding.availability !== "bound") {
    out.failureReason = `provider binding ${binding.availability}`;
    out.notes = binding.notes;
    return out;
  }
  if (binding.providerId === "describe-image") {
    out.failureReason = "describe-image is a plugin backend, not a proven Harness agent model";
    out.capabilities.vision = "unknown";
    out.capabilities.harness = "fail";
    return out;
  }
  if (!processReady()) {
    out.failureReason = "jsonrpc runtime process not ready";
    return out;
  }

  const bin = resolveJsonrpcBin();
  const harness = new DeepSeekHarness({
    launch: {
      command: process.execPath,
      args: [bin, CORDIS_PATH],
      cwd: join(root, "runtime"),
      env: {
        ...process.env,
        DSH_CORDIS_CONFIG: CORDIS_PATH,
        DSH_CWD: root,
        DSH_SESSION_ROOT: join(root, ".dsh-platform/sessions"),
        DSH_SYSTEM_PROMPT:
          "You are the electronics live qualifier. Call the named official tool and return only that JSON.",
      },
    },
    cwd: root,
    provider: binding.providerId,
    model: binding.model,
    maxTokens: 1024,
  });

  try {
    const prompt =
      "Load skill hello. Call hello_ping with token live-qualify. Return the tool JSON unchanged as a JSON object.";
    const result = await withTimeout(harness.run(prompt, { sessionId: `qual-${entry.id}-${Date.now()}` }), 90_000, "harness timeout");
    out.checks.harness = true;
    const extracted = extractNamedTool(result, "hello_ping");
    const ping = extracted?.value || null;
    out.checks.tool = Boolean(ping && (ping.plugin === "electronics-hello" || ping.token === "live-qualify"));
    out.checks.json = Boolean(ping && ping.ok === true);
    out.checks.long = Boolean(result?.finalResponse && String(result.finalResponse).length >= 20);
    if (entry.roles.includes("vision")) out.checks.vision = false;
    out.capabilities = scoreCaps(out.checks);
    const required = entry.roles.includes("vision")
      ? ["json", "toolCalling", "harness", "vision"]
      : ["json", "toolCalling", "harness"];
    const map = { toolCalling: "tool" };
    const passed = required.every((cap) => out.capabilities[cap] === "pass" || (cap === "toolCalling" && out.checks.tool));
    out.verified = passed && out.checks.harness && out.checks.tool && out.checks.json;
    out.pool = out.verified ? "production" : "candidate";
    if (!out.verified) out.failureReason = out.failureReason || "smoke checks incomplete";
  } catch (err) {
    out.failureReason = err instanceof Error ? err.message.slice(0, 180) : "smoke failed";
    out.capabilities.harness = /timeout/i.test(out.failureReason) ? "fail" : "fail";
  } finally {
    try {
      await harness.close();
    } catch {
      /* ignore */
    }
    out.ms = Date.now() - started;
  }
  return out;
}

const bindings = providerBindings();
const rows = [];
for (const id of FIRST_BATCH) {
  const entry = MODEL_CANDIDATES.find((m) => m.id === id);
  const binding = bindings.find((b) => b.id === id);
  process.stderr.write(`[qualify] ${id} via ${binding?.providerId}/${binding?.model}\n`);
  rows.push(await smokeOne(entry, binding || { providerId: "unknown", model: id, availability: "unbound" }));
}

const report = {
  at: new Date().toISOString(),
  processReady: processReady(),
  catalog: bindings.map((b) => ({
    id: b.id,
    providerId: b.providerId,
    model: b.model,
    availability: b.availability,
    auth: b.auth,
    source: b.source,
  })),
  results: rows.map((r) => ({
    id: r.id,
    providerId: r.providerId,
    model: r.model,
    verified: r.verified,
    pool: r.pool,
    availability: r.availability,
    capabilities: r.capabilities,
    failureReason: r.failureReason,
    notes: r.notes,
    ms: r.ms,
  })),
};

const destDir = join(root, "tests/phase82");
mkdirSync(destDir, { recursive: true });
const dest = join(destDir, "live-results.json");
let previous = [];
try {
  previous = JSON.parse(readFileSync(dest, "utf8")).results || [];
} catch {
  previous = [];
}
const merged = new Map(previous.map((r) => [r.id, r]));
for (const row of report.results) merged.set(row.id, row);
report.results = [...merged.values()];
writeFileSync(dest, `${JSON.stringify(report, null, 2)}\n`);
process.stderr.write(`[qualify] wrote tests/phase82/live-results.json (${rows.filter((r) => r.verified).length}/${rows.length} verified)\n`);
