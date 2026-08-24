/**
 * DeepSeekHarnessRuntime — official adapter.
 *
 * Deterministic work stays in core (no LLM).
 * Unstructured import and viaAgent research go through official
 * DeepSeekHarness + Skill + dsh Tool. No homemade agent loop.
 */
import { DeepSeekHarness } from "@deepseek-ai/dsh-sdk-client";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractImport } from "@electronics/import-core";
import { researchPart } from "@electronics/part-intelligence-core";
import { researchCompany } from "@electronics/company-intelligence-core";
import { extractNamedTool, loadOfficialTools, stubOfficialAgent } from "./harness-dispatch.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const runtimeDir = join(root, "runtime");
const cordis = join(runtimeDir, "jsonrpc.cordis.yml");

function resolveJsonrpcBin() {
  const candidates = [
    join(runtimeDir, "node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js"),
    join(root, "node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    "official dsh-jsonrpc-agent bin not found; run npm install in electronics-agent-platform/runtime",
  );
}

function wantsAgentPath(input) {
  return Boolean(input?.viaAgent) || process.env.ELECTRONICS_FORCE_HARNESS === "1";
}

function importPrompt(input) {
  return [
    "Load skill import.",
    "Convert this electronics import payload into ImportCandidate JSON only.",
    "Table: import_table_preview then import_apply_mapping. Do not invent a regex header matcher.",
    "Unstructured text: import_normalize_text, extract raw rows with MPN copied verbatim, then import_validate_rows.",
    "Never write a business database. Never return selected/duplicate/confirmImport.",
    "Return only JSON {candidates, mapping, usedAi}.",
    `Payload: ${JSON.stringify(input)}`,
  ].join(" ");
}

function partPrompt(input) {
  return [
    "Load skill part.",
    `Call part_research with the exact MPN ${JSON.stringify(input.mpn)}.`,
    "Do not truncate suffixes. Return the tool JSON unchanged. Never write a business database.",
    `Request: ${JSON.stringify({ mpn: input.mpn, goal: input.goal, steps: input.steps })}`,
  ].join(" ");
}

function companyPrompt(input) {
  return [
    "Load skill company.",
    `Call company_research with company ${JSON.stringify(input.company)}.`,
    "Return the tool JSON unchanged. Never write a business database.",
    `Request: ${JSON.stringify({ company: input.company, goal: input.goal, steps: input.steps })}`,
  ].join(" ");
}

async function officialRunAgent(job) {
  if (!existsSync(cordis)) throw new Error(`missing ${cordis}`);
  const bin = resolveJsonrpcBin();
  const sessionRoot = join(root, ".dsh-platform/sessions");
  const prompts = {
    hello: `Ping the electronics platform. Load skill hello if needed. Call hello_ping with token ${JSON.stringify(job.token)}. Return the tool JSON unchanged.`,
    import: importPrompt(job.input),
    part: partPrompt(job.input),
    company: companyPrompt(job.input),
  };
  const persona = {
    hello: "You are the electronics-agent-platform probe. Call hello_ping and return only that tool JSON.",
    import: "You are Import Intelligence. Follow skill import. Call official import_* tools. Return ImportCandidate JSON only.",
    part: "You are Part Intelligence. Follow skill part. Call part_research. Return that JSON only.",
    company: "You are Company Intelligence. Follow skill company. Call company_research. Return that JSON only.",
  };
  const harness = new DeepSeekHarness({
    launch: {
      command: process.execPath,
      args: [bin, cordis],
      cwd: runtimeDir,
      env: {
        ...process.env,
        DSH_CORDIS_CONFIG: cordis,
        DSH_CWD: root,
        DSH_SESSION_ROOT: sessionRoot,
        DSH_SYSTEM_PROMPT: process.env.DSH_SYSTEM_PROMPT || persona[job.kind],
      },
    },
    cwd: root,
    provider: "deepseek-official",
    model: process.env.DSH_MODEL || "deepseek-chat",
    maxTokens: 2048,
  });
  try {
    const result = await harness.run(prompts[job.kind], { sessionId: `${job.kind}-${Date.now()}` });
    const toolName =
      job.kind === "hello"
        ? "hello_ping"
        : job.kind === "import"
          ? "import_"
          : job.kind === "part"
            ? "part_research"
            : "company_research";
    const extracted = extractNamedTool(result, toolName);
    if (!extracted) {
      const err = new Error(`official runtime returned no ${toolName} result`);
      err.finalResponse = result.finalResponse;
      err.eventCount = result.events?.length ?? 0;
      throw err;
    }
    return { ...extracted.value, viaHarness: true, usedAi: true, toolsCalled: extracted.toolsCalled };
  } finally {
    await harness.close();
  }
}

export function createRuntime(overrides = {}) {
  const forceStub = process.env.ELECTRONICS_HARNESS_STUB === "1";
  const useOfficialLoop =
    !overrides.runAgent &&
    !forceStub &&
    (process.env.ELECTRONICS_USE_OFFICIAL_HARNESS === "1" || Boolean(process.env.DEEPSEEK_API_KEY));
  const tools = overrides.tools || (!useOfficialLoop ? loadOfficialTools() : null);
  const runAgent =
    overrides.runAgent ||
    (useOfficialLoop ? officialRunAgent : (job) => stubOfficialAgent(job, tools));

  return {
    async ping(token) {
      const out = await runAgent({ kind: "hello", token });
      if (!out || out.ok !== true) throw new Error("official runtime returned no hello_ping result");
      return out;
    },

    async runImport(input) {
      const core = await extractImport(input);
      if (!core.ok) return core;
      if (!core.needsAgent) {
        return { ...core, viaHarness: false, route: "core" };
      }
      const agent = await runAgent({ kind: "import", input });
      return {
        ok: agent.ok !== false,
        candidates: agent.candidates || [],
        mapping: agent.mapping ?? null,
        usedAi: true,
        needsAgent: false,
        viaHarness: true,
        route: "harness",
        toolsCalled: agent.toolsCalled || [],
        reason: agent.reason,
        preview: core.preview,
        textPreview: core.textPreview,
      };
    },

    async runPartResearch(input, ctx = {}) {
      if (!wantsAgentPath(input)) {
        const core = await researchPart(input, ctx);
        return { ...core, viaHarness: false, route: "core" };
      }
      const agent = await runAgent({ kind: "part", input, ctx });
      return { ...agent, viaHarness: true, route: "harness" };
    },

    async runCompanyResearch(input, ctx = {}) {
      if (!wantsAgentPath(input)) {
        const core = await researchCompany(input, ctx);
        return { ...core, viaHarness: false, route: "core" };
      }
      const agent = await runAgent({ kind: "company", input, ctx });
      return { ...agent, viaHarness: true, route: "harness" };
    },

    async startPartResearch(input, ctx = {}) {
      const result = await this.runPartResearch(input, ctx);
      return { type: "part_research", status: result.ok ? "done" : "failed", result };
    },

    async startCompanyResearch(input, ctx = {}) {
      const result = await this.runCompanyResearch(input, ctx);
      return { type: "company_research", status: result.ok ? "done" : "failed", result };
    },
  };
}
