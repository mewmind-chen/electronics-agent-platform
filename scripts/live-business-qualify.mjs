/**
 * Phase 8.3 business capability qualification.
 * Router identity → official DeepSeekHarness → Import/Part/Company Skill → dsh tools.
 * Never stub. Never prints secrets. Merges into tests/phase82/live-results.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  IMPORT_FIXTURE_TEXT,
  LONG_BOM_TEXT,
  MODEL_CANDIDATES,
  acceptImportRegression,
  acceptLongImport,
  acceptResearch,
  emptyBusiness,
  providerBindings,
} from "../packages/model-policy/src/index.js";
import { extractNamedTool } from "../apps/agent-api/src/harness-dispatch.js";
import { CORDIS_PATH, processReady, resolveJsonrpcBin } from "../apps/agent-api/src/agent-runtime.js";

const requireFromApi = createRequire(join(dirname(fileURLToPath(import.meta.url)), "../apps/agent-api/package.json"));
const { DeepSeekHarness } = requireFromApi("@deepseek-ai/dsh-sdk-client");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const JOBS = {
  "opencode-go/deepseek-v4-flash": ["import"],
  "litellm/free-fast": ["import"],
  "opencode-go/deepseek-v4-pro": ["part", "company"],
  "opencode-go/qwen3.7-max": ["part", "company"],
  "litellm/free-strong": ["part", "company"],
  "opencode-go/kimi-k3": ["long"],
  "litellm/free-long": ["long"],
};

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

function promptFor(skill, payload) {
  if (skill === "import" || skill === "long") {
    return [
      "Load skill import.",
      "Convert this electronics import payload into ImportCandidate JSON only.",
      "Unstructured or table text: import_normalize_text or import_table_preview, then import_validate_rows or import_apply_mapping.",
      "Copy MPN characters exactly. 10K is 10000. Never write a database.",
      "Return only JSON {candidates, mapping, usedAi}.",
      `Payload: ${JSON.stringify(payload)}`,
    ].join(" ");
  }
  if (skill === "part") {
    return [
      "Load skill part.",
      `Call part_research with the exact MPN ${JSON.stringify(payload.mpn)}.`,
      "Do not truncate suffixes. Return the tool JSON unchanged. Never write a database.",
      `Request: ${JSON.stringify(payload)}`,
    ].join(" ");
  }
  return [
    "Load skill company.",
    `Call company_research with company ${JSON.stringify(payload.company)}.`,
    "Return the tool JSON unchanged. Never write a database.",
    `Request: ${JSON.stringify(payload)}`,
  ].join(" ");
}

async function runSkill(binding, skill, payload) {
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
          skill === "part"
            ? "Follow skill part. Call part_research. Return that JSON only."
            : skill === "company"
              ? "Follow skill company. Call company_research. Return that JSON only."
              : "Follow skill import. Call official import_* tools. Return ImportCandidate JSON only.",
      },
    },
    cwd: root,
    provider: binding.providerId,
    model: binding.model,
    maxTokens: skill === "long" ? 4096 : 2048,
  });
  try {
    const result = await withTimeout(
      harness.run(promptFor(skill, payload), { sessionId: `biz-${binding.id}-${skill}-${Date.now()}` }),
      skill === "long" ? 180_000 : 120_000,
      "harness timeout",
    );
    const toolName = skill === "part" ? "part_research" : skill === "company" ? "company_research" : "import_";
    const extracted = extractNamedTool(result, toolName);
    return { ok: true, value: extracted?.value || null, toolsCalled: extracted?.toolsCalled || [], finalResponse: result.finalResponse };
  } finally {
    await harness.close();
  }
}

function scoreBusiness(entry, skills) {
  const biz = emptyBusiness();
  const tools = [];
  const reasons = [];
  let importPass = false;
  let longPass = false;
  for (const item of skills) {
    tools.push(...(item.toolsCalled || []));
    if (item.skill === "import") {
      const acc = acceptImportRegression(item.value || {});
      biz.import = acc.ok ? "pass" : "fail";
      importPass = acc.ok;
      if (!acc.ok) reasons.push(`import:${acc.reason}`);
    } else if (item.skill === "long") {
      const acc = acceptLongImport(item.value || {});
      longPass = acc.ok;
      biz.import = acc.ok ? "pass" : "fail";
      if (!acc.ok) reasons.push(`long:${acc.reason}`);
    } else if (item.skill === "part") {
      const acc = acceptResearch(item.value || {}, { kind: "part", expectedKey: "TPS54560DDAR" });
      biz.part = acc.ok ? "pass" : "fail";
      if (!acc.ok) reasons.push(`part:${acc.reason}`);
    } else if (item.skill === "company") {
      const acc = acceptResearch(item.value || {}, { kind: "company", expectedKey: "某某电子" });
      biz.company = acc.ok ? "pass" : "fail";
      if (!acc.ok) reasons.push(`company:${acc.reason}`);
    }
  }
  return { biz, tools: [...new Set(tools)], reasons, importPass, longPass };
}

const only = (process.env.QUALIFY_ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
const bindings = providerBindings();
const dest = join(root, "tests/phase82/live-results.json");
let previous = [];
try {
  previous = JSON.parse(readFileSync(dest, "utf8")).results || [];
} catch {
  previous = [];
}
const merged = new Map(previous.map((r) => [r.id, r]));

for (const id of Object.keys(JOBS)) {
  if (only.length && !only.includes(id)) continue;
  const entry = MODEL_CANDIDATES.find((m) => m.id === id);
  const binding = bindings.find((b) => b.id === id);
  const prev = merged.get(id) || {
    id,
    providerId: binding?.providerId,
    model: entry.model,
    verified: false,
    pool: "candidate",
    capabilities: {},
    businessQualified: emptyBusiness(),
  };
  process.stderr.write(`[biz] ${id} skills=${JOBS[id].join(",")}\n`);
  if (!processReady()) {
    merged.set(id, { ...prev, failureReason: "jsonrpc runtime process not ready", pool: "candidate" });
    continue;
  }
  const ran = [];
  for (const skill of JOBS[id]) {
    const payload =
      skill === "part"
        ? { mpn: "TPS54560DDAR", steps: ["hqew"] }
        : skill === "company"
          ? { company: "某某电子", steps: ["gys"] }
          : skill === "long"
            ? { kind: "offer", sourceType: "text", text: LONG_BOM_TEXT }
            : { kind: "offer", sourceType: "text", text: IMPORT_FIXTURE_TEXT };
    try {
      const out = await runSkill(binding, skill, payload);
      ran.push({ skill, ...out });
    } catch (err) {
      ran.push({ skill, ok: false, value: null, toolsCalled: [], error: err instanceof Error ? err.message : "failed" });
    }
  }
  const scored = scoreBusiness(entry, ran);
  const caps = {
    json: prev.capabilities?.json || "unknown",
    toolCalling: scored.tools.length ? "pass" : prev.capabilities?.toolCalling || "fail",
    structuredLong: JOBS[id].includes("long") ? (scored.longPass ? "pass" : "fail") : prev.capabilities?.structuredLong || "unknown",
    harness: "pass",
    vision: entry.roles.includes("vision") ? "unknown" : "n/a",
  };
  if (scored.importPass || scored.longPass) caps.json = "pass";
  if (scored.biz.part === "pass" || scored.biz.company === "pass") caps.json = "pass";
  const roleBizPass = entry.roles.includes("fast")
    ? scored.biz.import === "pass"
    : entry.roles.includes("long")
      ? scored.longPass
      : scored.biz.part === "pass" && scored.biz.company === "pass";
  const harnessOk = caps.harness === "pass" && caps.toolCalling === "pass" && caps.json === "pass";
  const verified = harnessOk; // hello-level verified may remain, business gate is separate
  merged.set(id, {
    ...prev,
    providerId: binding.providerId,
    model: binding.model,
    availability: binding.availability,
    capabilities: caps,
    businessQualified: scored.biz,
    skillsRun: ran.map((r) => ({ skill: r.skill, toolsCalled: r.toolsCalled, error: r.error || "" })),
    verified,
    pool: verified && roleBizPass ? "production" : "candidate",
    failureReason: scored.reasons.join(" | "),
    notes: ran.map((r) => r.skill).join(","),
  });
}

const report = {
  at: new Date().toISOString(),
  processReady: processReady(),
  catalog: bindings.map((b) => ({ id: b.id, providerId: b.providerId, model: b.model, availability: b.availability, auth: b.auth, source: b.source })),
  results: [...merged.values()],
};
mkdirSync(join(root, "tests/phase82"), { recursive: true });
writeFileSync(dest, `${JSON.stringify(report, null, 2)}\n`);
const prod = report.results.filter((r) => r.pool === "production").length;
process.stderr.write(`[biz] wrote ${dest} production=${prod}/${report.results.length}\n`);
