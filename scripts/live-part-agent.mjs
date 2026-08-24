/**
 * Phase 9.1 live: natural language → official Harness Part Agent.
 * Writes tests/phase9/live-chat.json. Never prints secrets.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAgentResponse } from "../packages/contracts/src/index.js";
import { createRuntime } from "../apps/agent-api/src/runtime.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = createRuntime({ env: { ...process.env, ELECTRONICS_HARNESS_STUB: "" } });
const started = Date.now();
const out = await runtime.runChat({
  message: "分析 TPS54560DDAR",
  mode: "agent",
  steps: ["lcsc", "hqew"],
});
const parsed = parseAgentResponse(out);
const report = {
  at: new Date().toISOString(),
  ms: Date.now() - started,
  ok: out.ok === true && parsed.ok === true,
  viaHarness: Boolean(out.viaHarness),
  skill: out.skill,
  toolsCalled: out.toolsCalled || [],
  mpn: out.result?.mpn || out.intent?.mpn,
  intent: out.intent,
  route: out.route,
  modelRoute: out.modelRoute,
  claimsCited: out.report?.claimsCited || [],
  reportHead: String(out.report?.markdown || "").slice(0, 400),
  error: out.error || (parsed.ok ? "" : parsed.errors.map((e) => e.message).join("; ")),
  researchKeys: out.result ? Object.keys(out.result) : [],
  rawOk: out.ok,
  rawReason: out.reason,
  rawErrors: out.result?.errors || null,
};
writeFileSync(join(root, "tests/phase9/live-chat.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stderr.write(`[phase9] live chat ok=${report.ok} viaHarness=${report.viaHarness} tools=${report.toolsCalled.join(",")}\n`);
if (!report.ok) process.exitCode = 1;
