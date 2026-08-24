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
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseExecutionMode } from "@electronics/contracts";
import { extractImport } from "@electronics/import-core";
import {
  attachBusinessContextToPartResult,
  composePartReport,
  inferPartIntent,
  normalizePartResult,
  researchPart,
} from "@electronics/part-intelligence-core";
import { researchCompany } from "@electronics/company-intelligence-core";
import { inferTaskFromInput, nextEscalationRole, toModelRoute } from "@electronics/model-policy";
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

export function isVisionImport(input = {}) {
  return (
    input.role === "vision" ||
    String(input.sourceType || "").toLowerCase() === "image" ||
    String(input.mime || "").toLowerCase().startsWith("image/")
  );
}

export function canonicalImageBase64(data) {
  const raw = String(data || "").replace(/\s+/g, "");
  if (!raw) return "";
  return Buffer.from(raw, "base64").toString("base64");
}

export function imageMediaType(input = {}) {
  const mime = String(input.mime || "").toLowerCase();
  if (mime === "image/png" || mime === "image/jpeg" || mime === "image/webp" || mime === "image/gif") return mime;
  const name = String(input.filename || "").toLowerCase();
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  return "image/png";
}

function importPrompt(input) {
  const payload = { ...input };
  const tableMapping = Boolean(payload.preview && (payload.sourceType === "excel" || payload.sourceType === "csv"));
  if (isVisionImport(payload) && payload.fileBase64) {
    payload.fileBase64 = "[attached image]";
  }
  if (tableMapping) {
    delete payload.fileBase64;
    delete payload.text;
  }
  const image = isVisionImport(input);
  const pathHint = image
    ? "The user message includes the picture as an image block. Read that attached image, extract raw rows with MPN copied verbatim, keep qty/dateCode/price in separate fields, then import_validate_rows."
    : tableMapping
      ? "The Platform already read the table bytes and supplied a bounded preview. Infer one semantic column mapping, then call import_validate_mapping with preview.header and {columns:[{header,target}]}. Do not request or relay file bytes. The Platform will deterministically apply the accepted mapping to every original row."
      : "Unstructured text: import_normalize_text, extract raw rows with MPN copied verbatim, keep qty/dateCode/price/leadTimeText separate, apply explicit shared or unified facts to every affected row, then import_validate_rows.";
  return [
    "Load skill import.",
    "Convert this electronics import payload into ImportCandidate JSON only.",
    pathHint,
    "Never write a business database. Never return selected/duplicate/confirmImport.",
    tableMapping ? "Return the import_validate_mapping JSON unchanged." : "Return only JSON {candidates, mapping, usedAi}.",
    `Payload: ${JSON.stringify(payload)}`,
  ].join(" ");
}

export function prepareImportAgentInput(input, core) {
  if (core?.reason !== "table_mapping_required" || !core.preview) return input;
  return {
    kind: input.kind,
    sourceType: input.sourceType,
    filename: input.filename,
    mime: input.mime,
    mode: input.mode,
    role: input.role,
    modelMode: input.modelMode,
    quality: input.quality,
    provider: input.provider,
    model: input.model,
    preview: core.preview,
  };
}

export function createSessionId(kind) {
  return `${String(kind || "agent")}-${Date.now()}-${randomUUID()}`;
}

/** String prompt, or text+encoded-image blocks for vision import. */
export function importAgentInput(input) {
  const text = importPrompt(input);
  if (!isVisionImport(input) || !input?.fileBase64) return text;
  const data = canonicalImageBase64(input.fileBase64);
  if (!data) return text;
  return [
    { type: "text", text },
    { type: "image", mediaType: imageMediaType(input), data },
  ];
}

function partPrompt(input) {
  return [
    "Load skill part.",
    "Follow Goal, Tools, Steps, Evidence, Answer, Hard rules.",
    `The user said: ${JSON.stringify(input.message || `分析 ${input.mpn}`)}.`,
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
    import: importAgentInput(job.input),
    part: partPrompt(job.input),
    company: companyPrompt(job.input),
  };
  const persona = {
    hello: "You are the electronics-agent-platform probe. Call hello_ping and return only that tool JSON.",
    import: "You are Import Intelligence. Follow skill import. Call official import_* tools. Return ImportCandidate JSON only.",
    part: "You are the Electronics Part Intelligence Agent. Follow skill part. Call part_research. Return that JSON only. Never write a database.",
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
  let removeAbort = () => {};
  try {
    if (job.signal?.aborted) throw job.signal.reason || new Error("task_cancelled");
    const aborted = new Promise((_, reject) => {
      const abort = () => {
        const error = job.signal?.reason instanceof Error ? job.signal.reason : new Error("task_cancelled");
        Promise.resolve(harness.close()).catch(() => {});
        reject(error);
      };
      if (job.signal?.aborted) return abort();
      if (job.signal) {
        job.signal.addEventListener("abort", abort, { once: true });
        removeAbort = () => job.signal.removeEventListener("abort", abort);
      }
    });
    const result = await Promise.race([harness.run(prompts[job.kind], { sessionId: createSessionId(job.kind) }), aborted]);
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
    removeAbort();
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
    const canRun = Boolean(resolved.available && (resolved.policy?.provider || resolved.modelRoute?.model));
    if (mode === "agent" && !canRun) return unavailable(mode, resolved.reason || "no_capable_model", modelRoute);
    if (allowStub && mode !== "agent") {
      const stub = await stubOfficialAgent(job, overrides.tools);
      return { ...stub, viaHarness: false, usedAi: false, route: "stub", mode, modelRoute };
    }
    if (!canRun) return unavailable(mode, resolved.reason || "no_capable_model", modelRoute);
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

    async ping(token, ctx = {}) {
      const out = await tryAgent({ kind: "hello", token, signal: ctx.signal }, "agent");
      if (out.error === AGENT_UNAVAILABLE) throw new Error(AGENT_UNAVAILABLE);
      if (!out || out.ok !== true) throw new Error("official runtime returned no hello_ping result");
      return out;
    },

    async runImport(input, ctx = {}) {
      const mode = resolveExecutionMode(input);
      const core = await extractImport(input);
      if (!core.ok) return { ...core, mode, viaHarness: false, usedAi: false, route: "core" };
      const deterministic = !core.needsAgent;

      if (mode === "core" || (deterministic && mode !== "agent")) {
        return withCoreMeta(core, mode);
      }

      if (core.reason === "vision_required" || isVisionImport(input)) {
        const vision = await tryAgent({ kind: "import", input: { ...input, role: "vision" }, signal: ctx.signal }, mode);
        if (vision.error === AGENT_UNAVAILABLE) {
          return {
            ok: false,
            error: "vision_unavailable",
            reason: "no business-qualified vision model",
            mode,
            viaHarness: false,
            usedAi: false,
            candidates: [],
            modelRoute: null,
          };
        }
        let out = {
          ok: vision.ok !== false,
          candidates: vision.candidates || [],
          mapping: vision.mapping ?? null,
          usedAi: Boolean(vision.usedAi),
          needsAgent: false,
          viaHarness: Boolean(vision.viaHarness),
          route: vision.route,
          mode,
          toolsCalled: vision.toolsCalled || [],
          reason: vision.reason,
          preview: core.preview,
          textPreview: core.textPreview,
          modelRoute: vision.modelRoute || null,
        };
        const escalate = nextEscalationRole("import", out, out.modelRoute?.role || "vision");
        if (escalate && mode !== "core") {
          const again = await tryAgent({ kind: "import", input: { ...input, role: escalate }, signal: ctx.signal }, mode);
          if (again.ok !== false && again.error !== AGENT_UNAVAILABLE) {
            out = {
              ...out,
              ...again,
              candidates: again.candidates || out.candidates,
              usedAi: true,
              viaHarness: Boolean(again.viaHarness),
              modelRoute: again.modelRoute ? { ...again.modelRoute, escalated: true } : out.modelRoute,
            };
          }
        }
        return out;
      }
      const tableMapping = core.reason === "table_mapping_required" && Boolean(core.preview);
      const agentInput = tableMapping ? prepareImportAgentInput(input, core) : input;
      const agent = await tryAgent({ kind: "import", input: agentInput, signal: ctx.signal }, mode);
      if (agent.error === AGENT_UNAVAILABLE) {
        if (mode === "agent") return agent;
        return {
          ...withCoreMeta(core, mode, "agent_unavailable"),
          needsAgent: true,
          reason: core.reason || AGENT_UNAVAILABLE,
        };
      }
      if (tableMapping) {
        if (!agent.mapping) {
          return {
            ok: false,
            error: "mapping_unavailable",
            reason: agent.reason || "agent returned no validated table mapping",
            candidates: [],
            mapping: null,
            usedAi: Boolean(agent.usedAi),
            needsAgent: true,
            viaHarness: Boolean(agent.viaHarness),
            route: agent.route,
            mode,
            toolsCalled: agent.toolsCalled || [],
            preview: core.preview,
            modelRoute: agent.modelRoute || null,
          };
        }
        const mapped = await extractImport({ ...input, mapping: agent.mapping });
        if (!mapped.ok || mapped.needsAgent) {
          return {
            ok: false,
            error: "invalid_mapping_result",
            reason: mapped.error || mapped.reason || "validated mapping could not be applied",
            errors: mapped.errors || [],
            candidates: [],
            mapping: agent.mapping,
            usedAi: Boolean(agent.usedAi),
            needsAgent: true,
            viaHarness: Boolean(agent.viaHarness),
            route: agent.route,
            mode,
            toolsCalled: agent.toolsCalled || [],
            preview: core.preview,
            modelRoute: agent.modelRoute || null,
          };
        }
        return {
          ...mapped,
          usedAi: true,
          needsAgent: false,
          viaHarness: Boolean(agent.viaHarness),
          route: agent.route,
          mode,
          toolsCalled: agent.toolsCalled || [],
          preview: core.preview,
          modelRoute: agent.modelRoute || null,
        };
      }
      let out = {
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
      const escalate = nextEscalationRole("import", out, out.modelRoute?.role || "fast");
      if (escalate && mode !== "core") {
        const again = await tryAgent({ kind: "import", input: { ...input, role: escalate }, signal: ctx.signal }, mode);
        if (again.ok !== false && again.error !== AGENT_UNAVAILABLE) {
          out = {
            ...out,
            ...again,
            candidates: again.candidates || out.candidates,
            usedAi: true,
            viaHarness: Boolean(again.viaHarness),
            modelRoute: again.modelRoute ? { ...again.modelRoute, escalated: true } : out.modelRoute,
          };
        }
      }
      return out;
    },

    async runPartResearch(input, ctx = {}) {
      const mode = resolveExecutionMode(input);
      if (mode === "core") return withCoreMeta(await researchPart(input, ctx), mode);
      const agent = await tryAgent({ kind: "part", input, ctx, signal: ctx.signal }, mode);
      if (agent.error === AGENT_UNAVAILABLE) {
        if (mode === "agent") return agent;
        return withCoreMeta(await researchPart(input, ctx), mode, "agent_unavailable");
      }
      const enriched = attachBusinessContextToPartResult(agent, input, ctx);
      const escalate = nextEscalationRole("part", enriched, enriched.modelRoute?.role || "reasoning");
      if (escalate && mode !== "core") {
        const again = await tryAgent({ kind: "part", input: { ...input, role: escalate }, ctx, signal: ctx.signal }, mode);
        if (again && again.ok !== false && !again.error) {
          const enrichedAgain = attachBusinessContextToPartResult(again, input, ctx);
          return {
            ...enrichedAgain,
            modelRoute: enrichedAgain.modelRoute
              ? { ...enrichedAgain.modelRoute, escalated: true }
              : enrichedAgain.modelRoute,
          };
        }
        return { ...enriched, premiumReviewUnavailable: true };
      }
      return enriched;
    },

    async runCompanyResearch(input, ctx = {}) {
      const mode = resolveExecutionMode(input);
      if (mode === "core") return withCoreMeta(await researchCompany(input, ctx), mode);
      const agent = await tryAgent({ kind: "company", input, ctx, signal: ctx.signal }, mode);
      if (agent.error === AGENT_UNAVAILABLE) {
        if (mode === "agent") return agent;
        return withCoreMeta(await researchCompany(input, ctx), mode, "agent_unavailable");
      }
      const escalate = nextEscalationRole("company", agent, agent.modelRoute?.role || "reasoning");
      if (escalate && mode !== "core") {
        const again = await tryAgent({ kind: "company", input: { ...input, role: escalate }, ctx, signal: ctx.signal }, mode);
        if (again && again.ok !== false && !again.error) {
          return { ...again, modelRoute: again.modelRoute ? { ...again.modelRoute, escalated: true } : again.modelRoute };
        }
        return { ...agent, premiumReviewUnavailable: true };
      }
      return agent;
    },

    async runChat(input, ctx = {}) {
      const message = String(input.message || "").trim();
      const intent = inferPartIntent(message);
      if (intent.kind !== "part_research") {
        return {
          ok: false,
          intent,
          skill: null,
          toolsCalled: [],
          error: "unsupported_intent",
          reason: intent.reason,
          viaHarness: false,
          usedAi: false,
          route: "unsupported",
          mode: resolveExecutionMode(input),
        };
      }
      const research = await this.runPartResearch(
        {
          ...input,
          mpn: intent.mpn,
          goal: input.goal || message,
          message,
        },
        ctx,
      );
      const normalized = research.error === "agent_unavailable" ? null : normalizePartResult(research, intent.mpn);
      const parsedOk = Boolean(normalized && composePartReport(normalized, intent.mpn));
      const report = parsedOk ? composePartReport(normalized, intent.mpn) : { markdown: "研究未完成。", claimsCited: [] };
      return {
        ok: parsedOk && research.error !== "agent_unavailable",
        intent,
        skill: "part",
        toolsCalled: research.toolsCalled || (research.viaHarness ? ["part_research"] : []),
        result: parsedOk ? { ...research, ...normalized, ok: true } : null,
        report,
        viaHarness: Boolean(research.viaHarness),
        usedAi: Boolean(research.usedAi),
        route: research.route,
        mode: research.mode,
        modelRoute: research.modelRoute || null,
        error: research.error,
        reason: research.reason,
        premiumReviewUnavailable: Boolean(research.premiumReviewUnavailable),
      };
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
