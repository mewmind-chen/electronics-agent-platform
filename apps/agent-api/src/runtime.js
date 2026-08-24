/**
 * DeepSeekHarnessRuntime — official adapter.
 *
 * mode:
 *   auto  (default)  Harness available → official agent; else Core fallback
 *   agent            official DeepSeekHarness only; unavailable → agent_unavailable
 *   core             deterministic core only; never start Harness
 *
 * stubOfficialAgent is test-only (ELECTRONICS_HARNESS_STUB=1).
 * Production never labels stub output as viaHarness / usedAi.
 */
import { DeepSeekHarness } from "@deepseek-ai/dsh-sdk-client";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseExecutionMode } from "@electronics/contracts";
import { extractImport } from "@electronics/import-core";
import { researchPart } from "@electronics/part-intelligence-core";
import { researchCompany } from "@electronics/company-intelligence-core";
import { inferTaskFromInput, toModelRoute } from "@electronics/model-policy";
import {
  isAgentAvailable,
  resolveAgentRuntime,
  resolveJsonrpcBin,
  resolveModelPolicy,
} from "./agent-runtime.js";
import { extractNamedTool, stubOfficialAgent } from "./harness-dispatch.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const runtimeDir = join(root, "runtime");

export const AGENT_UNAVAILABLE = "agent_unavailable";
export { isAgentAvailable, resolveAgentRuntime, resolveJsonrpcBin };

export function officialHarnessAvailable(env = process.env, override) {
  return isAgentAvailable({ env, override });
}

export function isTestStubEnabled(env = process.env) {
  return env.ELECTRONICS_HARNESS_STUB === "1";
}

export function resolveExecutionMode(input) {
  return parseExecutionMode(input, "request", []);
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

function unavailable(mode, reason = "official DeepSeek Harness is not available", modelRoute = null) {
  return {
    ok: false,
    error: AGENT_UNAVAILABLE,
    reason,
    mode,
    viaHarness: false,
    usedAi: false,
    route: "unavailable",
    candidates: [],
    modelRoute,
  };
}

function withCoreMeta(result, mode, fallbackFrom = null) {
  return {
    ...result,
    mode,
    viaHarness: false,
    usedAi: false,
    route: fallbackFrom ? "core_fallback" : "core",
    fallbackFrom,
    modelRoute: null,
  };
}

async function officialRunAgent(job, agentRuntime) {
  const resolved = agentRuntime || resolveAgentRuntime({ env: process.env, modelPolicy: job.modelPolicy });
  if (!resolved.available || !resolved.bin) {
    throw new Error(AGENT_UNAVAILABLE);
  }
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
      args: [resolved.bin, resolved.cordis],
      cwd: runtimeDir,
      env: {
        ...process.env,
        DSH_CORDIS_CONFIG: resolved.cordis,
        DSH_CWD: root,
        DSH_SESSION_ROOT: sessionRoot,
        DSH_SYSTEM_PROMPT: process.env.DSH_SYSTEM_PROMPT || persona[job.kind],
      },
    },
    cwd: root,
    provider: resolved.policy.provider,
    model: resolved.policy.model,
    maxTokens: resolved.policy.maxTokens,
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
    return {
      ...extracted.value,
      viaHarness: true,
      usedAi: true,
      route: "harness",
      toolsCalled: extracted.toolsCalled,
      modelRoute: resolved.modelRoute || toModelRoute(resolved.policy),
    };
  } finally {
    await harness.close();
  }
}

export function createRuntime(overrides = {}) {
  const env = overrides.env || process.env;
  const allowStub = Boolean(overrides.allowStub) || isTestStubEnabled(env);
  const router = overrides.router;
  const agentRuntime =
    overrides.agentRuntime ||
    resolveAgentRuntime({
      env,
      modelPolicy: overrides.modelPolicy,
      overrideAvailable: overrides.harnessAvailable,
      router,
    });
  const officialRunner = overrides.officialRunAgent || ((job) => officialRunAgent(job, job.agentRuntime || agentRuntime));
  let harnessStarts = 0;
  let routerCalls = 0;

  function routeFor(kind, input) {
    routerCalls += 1;
    const task = inferTaskFromInput(kind, input);
    return resolveAgentRuntime({
      env,
      modelPolicy: input,
      overrideAvailable: overrides.harnessAvailable,
      router: router || agentRuntime.router,
      task,
    });
  }

  async function runOfficial(job, resolved) {
    harnessStarts += 1;
    return officialRunner({ ...job, modelPolicy: resolved.policy, agentRuntime: resolved });
  }

  async function tryAgent(job, mode) {
    if (mode === "core") return unavailable(mode, "core_does_not_start_harness");
    const resolved = routeFor(job.kind, job.input || {});
    const modelRoute = resolved.modelRoute;
    if (mode === "agent" && !resolved.available) return unavailable(mode, resolved.reason, modelRoute);
    if (allowStub && mode !== "agent") {
      const stub = await stubOfficialAgent(job, overrides.tools);
      return { ...stub, viaHarness: false, usedAi: false, route: "stub", mode, modelRoute };
    }
    if (!resolved.available) return unavailable(mode, resolved.reason, modelRoute);
    try {
      const out = await runOfficial(job, resolved);
      return { ...out, mode, viaHarness: true, usedAi: true, route: "harness", modelRoute: out.modelRoute || modelRoute };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const activeRouter = router || agentRuntime.router;
      if (activeRouter && job.input) {
        const next = activeRouter.fallback(
          { ...(resolved.modelRoute || {}), ...(resolved.policy || {}), id: resolved.policy?.id || resolved.modelRoute?.id },
          inferTaskFromInput(job.kind, job.input),
          err,
        );
        if (next?.ok) {
          const retried = resolveAgentRuntime({
            env,
            modelPolicy: { provider: next.provider, model: next.model, modelRoute: toModelRoute(next) },
            overrideAvailable: true,
            router: activeRouter,
          });
          try {
            const out = await runOfficial(job, retried);
            return {
              ...out,
              mode,
              viaHarness: true,
              usedAi: true,
              route: "harness",
              modelRoute: toModelRoute(next),
            };
          } catch (err2) {
            return unavailable(mode, err2 instanceof Error ? err2.message : String(err2), toModelRoute(next));
          }
        }
      }
      return unavailable(mode, message, modelRoute);
    }
  }

  return {
    get harnessStarts() {
      return harnessStarts;
    },
    get routerCalls() {
      return routerCalls;
    },
    harnessAvailable: Boolean(agentRuntime.available),
    stubAllowed: allowStub,
    modelPolicy: agentRuntime.policy,
    isAgentAvailable: (input) => {
      const task = input ? inferTaskFromInput(input.kind || "import", input) : undefined;
      return isAgentAvailable({
        env,
        policy: resolveModelPolicy(input || {}, env, { router: router || agentRuntime.router, task }),
        override: overrides.harnessAvailable,
        router: router || agentRuntime.router,
        task,
      });
    },
    resolveAgentRuntime: () => agentRuntime,

    async ping(token) {
      const out = await tryAgent({ kind: "hello", token }, "agent");
      if (out.error === AGENT_UNAVAILABLE) throw new Error(AGENT_UNAVAILABLE);
      if (!out || out.ok !== true) throw new Error("official runtime returned no hello_ping result");
      return out;
    },

    async runImport(input) {
      const mode = resolveExecutionMode(input);
      const core = await extractImport(input);
      if (!core.ok) return { ...core, mode, viaHarness: false, usedAi: false, route: "core" };
      const deterministic = !core.needsAgent;

      if (mode === "core" || (deterministic && mode !== "agent")) {
        return withCoreMeta(core, mode);
      }

      const agent = await tryAgent({ kind: "import", input }, mode);
      if (agent.error === AGENT_UNAVAILABLE) {
        if (mode === "agent") return agent;
        return {
          ...withCoreMeta(core, mode, "agent_unavailable"),
          needsAgent: true,
          reason: core.reason || AGENT_UNAVAILABLE,
        };
      }
      return {
        ok: agent.ok !== false,
        candidates: agent.candidates || [],
        mapping: agent.mapping ?? null,
        usedAi: Boolean(agent.usedAi),
        needsAgent: false,
        viaHarness: Boolean(agent.viaHarness),
        route: agent.route,
        mode,
        toolsCalled: agent.toolsCalled || [],
        reason: agent.reason,
        preview: core.preview,
        textPreview: core.textPreview,
        modelRoute: agent.modelRoute || null,
      };
    },

    async runPartResearch(input, ctx = {}) {
      const mode = resolveExecutionMode(input);
      if (mode === "core") return withCoreMeta(await researchPart(input, ctx), mode);
      const agent = await tryAgent({ kind: "part", input, ctx }, mode);
      if (agent.error === AGENT_UNAVAILABLE) {
        if (mode === "agent") return agent;
        return withCoreMeta(await researchPart(input, ctx), mode, "agent_unavailable");
      }
      return agent;
    },

    async runCompanyResearch(input, ctx = {}) {
      const mode = resolveExecutionMode(input);
      if (mode === "core") return withCoreMeta(await researchCompany(input, ctx), mode);
      const agent = await tryAgent({ kind: "company", input, ctx }, mode);
      if (agent.error === AGENT_UNAVAILABLE) {
        if (mode === "agent") return agent;
        return withCoreMeta(await researchCompany(input, ctx), mode, "agent_unavailable");
      }
      return agent;
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
