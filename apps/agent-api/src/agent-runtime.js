/**
 * Agent availability + Model Policy seam.
 *
 * Layering (do not collapse):
 *   execution mode  →  core / Harness / auto-fallback
 *   model policy    →  which provider/model the Harness process should use
 *
 * Availability is "can the Model Router resolve a usable model?"
 * Callers must not hardcode DEEPSEEK_API_KEY.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createModelRouter,
  inferTaskFromInput,
  stripSecrets,
  toModelRoute,
} from "@electronics/model-policy";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const runtimeDir = join(root, "runtime");
export const CORDIS_PATH = join(runtimeDir, "jsonrpc.cordis.yml");

export function resolveJsonrpcBin() {
  const candidates = [
    join(runtimeDir, "node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js"),
    join(root, "node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function processReady(env = process.env) {
  const bin = env.DSH_JSONRPC_BIN || resolveJsonrpcBin();
  const cordis = env.DSH_CORDIS_CONFIG || CORDIS_PATH;
  return Boolean(bin) && existsSync(cordis);
}

export function createAgentRouter({ env = process.env, registry, health, now } = {}) {
  return createModelRouter({ env, registry, health, now });
}

/**
 * Resolve provider/model for one task. Does not start Harness.
 * override.route short-circuits for tests; override.available forces yes/no.
 */
export function resolveModelPolicy(input = {}, env = process.env, extras = {}) {
  if (extras.route) return extras.route;
  const router = extras.router || createAgentRouter({ env, registry: extras.registry, health: extras.health });
  const kind = input.kind || extras.kind || extras.task?.kind || "import";
  const task = extras.task || inferTaskFromInput(kind, { sourceType: "text", ...input, kind });
  const resolved = router.resolve(task);
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.error,
      reason: resolved.reason,
      provider: undefined,
      model: undefined,
      credentialEnv: undefined,
      maxTokens: 2048,
      modelRoute: null,
    };
  }
  return {
    ok: true,
    provider: resolved.provider,
    model: resolved.model,
    credentialEnv: resolved.credentialEnv,
    maxTokens: Number(input.maxTokens || env.DSH_MAX_TOKENS) > 0 ? Number(input.maxTokens || env.DSH_MAX_TOKENS) : 2048,
    modelRoute: toModelRoute(resolved),
    id: resolved.id,
  };
}

export function isAgentAvailable({
  env = process.env,
  policy,
  processIsReady = processReady(env),
  override,
  router,
  task,
} = {}) {
  if (override !== undefined) return Boolean(override);
  if (!processIsReady) return false;
  if (policy?.ok === false) return false;
  if (policy?.provider && policy?.model && policy?.ok !== false) {
    if (policy.credentialEnv && !String(env[policy.credentialEnv] || "").trim()) return false;
    return true;
  }
  const resolved = resolveModelPolicy(task || {}, env, { router, task });
  return Boolean(resolved.ok && resolved.provider && resolved.model);
}

export function resolveAgentRuntime({
  env = process.env,
  modelPolicy,
  overrideAvailable,
  router,
  task,
  registry,
  health,
} = {}) {
  const activeRouter = router || createAgentRouter({ env, registry, health });
  const policy = modelPolicy?.provider
    ? { ok: true, ...modelPolicy, modelRoute: modelPolicy.modelRoute || null }
    : task || modelPolicy?.kind || modelPolicy?.sourceType || modelPolicy?.mpn || modelPolicy?.company
      ? resolveModelPolicy(modelPolicy || task || {}, env, { router: activeRouter, task })
      : { ok: false, reason: "no_task", provider: undefined, model: undefined, modelRoute: null };
  const processIsReady = processReady(env);
  const available = isAgentAvailable({
    env,
    policy,
    processIsReady,
    override: overrideAvailable,
    router: activeRouter,
    task,
  });
  return {
    available,
    processReady: processIsReady,
    policy: stripSecrets(policy),
    modelRoute: policy.modelRoute || null,
    router: activeRouter,
    reason: available ? "ok" : processIsReady ? policy.reason || "no_capable_model" : "runtime_process_missing",
    bin: env.DSH_JSONRPC_BIN || resolveJsonrpcBin(),
    cordis: env.DSH_CORDIS_CONFIG || CORDIS_PATH,
  };
}
