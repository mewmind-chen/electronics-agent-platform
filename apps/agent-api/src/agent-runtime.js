/**
 * Agent availability + Model Policy seam.
 *
 * Layering (do not collapse):
 *   execution mode  →  core / Harness / auto-fallback
 *   model policy    →  which provider/model the Harness process should use
 *
 * This file is the future Model Router hook. It must stay replaceable.
 * Do not implement multi-model routing here.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const runtimeDir = join(root, "runtime");
export const CORDIS_PATH = join(runtimeDir, "jsonrpc.cordis.yml");

export const DEFAULT_MODEL_POLICY = Object.freeze({
  provider: "deepseek-official",
  model: "deepseek-chat",
  maxTokens: 2048,
  credentialEnv: "DEEPSEEK_API_KEY",
});

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

/** Config-only policy. Future router replaces this function, not callers. */
export function resolveModelPolicy(input = {}, env = process.env) {
  const src = input && typeof input === "object" ? input : {};
  const maxRaw = src.maxTokens ?? env.DSH_MAX_TOKENS;
  const maxTokens = Number(maxRaw);
  return {
    provider: String(src.provider || env.DSH_PROVIDER || DEFAULT_MODEL_POLICY.provider),
    model: String(src.model || env.DSH_MODEL || DEFAULT_MODEL_POLICY.model),
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : DEFAULT_MODEL_POLICY.maxTokens,
    credentialEnv: String(src.credentialEnv || env.DSH_CREDENTIAL_ENV || DEFAULT_MODEL_POLICY.credentialEnv),
  };
}

/**
 * Process + configured credential for the *resolved* policy.
 * Callers must not hardcode DEEPSEEK_API_KEY.
 */
export function isAgentAvailable({
  env = process.env,
  policy = resolveModelPolicy({}, env),
  processIsReady = processReady(env),
  override,
} = {}) {
  if (override !== undefined) return Boolean(override);
  if (!processIsReady) return false;
  const cred = String(env[policy.credentialEnv] || "").trim();
  return Boolean(cred);
}

export function resolveAgentRuntime({
  env = process.env,
  modelPolicy,
  overrideAvailable,
} = {}) {
  const policy = resolveModelPolicy(modelPolicy, env);
  const processIsReady = processReady(env);
  const available = isAgentAvailable({ env, policy, processIsReady, override: overrideAvailable });
  return {
    available,
    processReady: processIsReady,
    policy,
    reason: available ? "ok" : processIsReady ? "credential_missing" : "runtime_process_missing",
    bin: env.DSH_JSONRPC_BIN || resolveJsonrpcBin(),
    cordis: env.DSH_CORDIS_CONFIG || CORDIS_PATH,
  };
}
