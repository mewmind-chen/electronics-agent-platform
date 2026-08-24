/**
 * Deterministic model router. Priority + capability + health + quality.
 * Never random. Never logs or returns API keys.
 */
import { QUALITY_RANK, inProductionPool, meetsCapabilities, MODEL_REGISTRY } from "./registry.js";
import { inferRole } from "./role.js";
import { classifyProviderError, createHealthBook, isRetryableProviderError } from "./health.js";

function hasCredential(entry, env) {
  if (!entry.credentialEnv) return true;
  if (!env) return true;
  return Boolean(String(env[entry.credentialEnv] || "").trim());
}

function qualityOk(entry, quality, role) {
  const have = QUALITY_RANK[entry.quality] ?? QUALITY_RANK.standard;
  if (quality === "economy") return have <= QUALITY_RANK.economy;
  if (quality === "quality" || role === "premium") return true;
  return have <= QUALITY_RANK.standard;
}

function sortCandidates(list) {
  return [...list].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return String(a.id).localeCompare(String(b.id));
  });
}

export function createModelRouter({
  registry = MODEL_REGISTRY,
  env = process.env,
  health,
  now,
} = {}) {
  const book = health || createHealthBook({ now });

  function candidatesFor(role, quality) {
    return sortCandidates(
      registry.filter(
        (entry) =>
          inProductionPool(entry) &&
          entry.roles.includes(role) &&
          meetsCapabilities(entry, role) &&
          qualityOk(entry, quality, role) &&
          book.isHealthy(entry) &&
          hasCredential(entry, env),
      ),
    );
  }

  function resolve(task = {}) {
    const modelMode = task.modelMode || "auto";
    const quality = task.quality || "standard";
    const role = inferRole(task);

    if (modelMode === "fixed") {
      const hit = registry.find((e) => e.provider === task.provider && e.model === task.model);
      if (!hit || !inProductionPool(hit) || !meetsCapabilities(hit, role) || !book.isHealthy(hit) || !hasCredential(hit, env)) {
        return { ok: false, error: "agent_unavailable", reason: "fixed_model_unavailable", role, quality, modelMode };
      }
      return routeFrom(hit, role, quality, 0, false);
    }

    if (modelMode === "selected") {
      return {
        ok: false,
        error: "selected_not_bound",
        reason: "session model binding is reserved; no UI in this phase",
        role,
        quality,
        modelMode,
        sessionModel: task.sessionModel || null,
      };
    }

    const escalated = role === "premium";
    const list = candidatesFor(role, quality);
    if (!list.length) {
      return { ok: false, error: "agent_unavailable", reason: "no_capable_model", role, quality, modelMode };
    }
    return routeFrom(list[0], role, quality, 0, escalated);
  }

  function routeFrom(entry, role, quality, fallbackCount, escalated) {
    return {
      ok: true,
      role,
      provider: entry.provider,
      model: entry.model,
      quality: entry.quality,
      requestedQuality: quality,
      fallbackCount,
      escalated,
      id: entry.id,
      credentialEnv: entry.credentialEnv,
    };
  }

  function sameModel(entry, previous) {
    if (!previous) return false;
    if (previous.id && entry.id === previous.id) return true;
    return entry.provider === previous.provider && entry.model === previous.model;
  }

  function fallback(previous, task = {}, error) {
    const kind = classifyProviderError(error);
    if (!isRetryableProviderError(kind)) {
      return { ok: false, error: "agent_unavailable", reason: kind, role: previous?.role };
    }
    const failed = registry.find((e) => sameModel(e, previous));
    if (failed) book.markFailure(failed, error);
    const quality = task.quality || previous?.requestedQuality || "standard";
    const role = previous?.role || inferRole(task);
    const list = candidatesFor(role, quality).filter((e) => !sameModel(e, previous));
    if (!list.length) {
      return { ok: false, error: "agent_unavailable", reason: kind, role, quality, modelMode: task.modelMode || "auto" };
    }
    return routeFrom(list[0], role, quality, (previous?.fallbackCount || 0) + 1, Boolean(previous?.escalated));
  }

  return { resolve, fallback, candidatesFor, health: book };
}

export function toModelRoute(resolved) {
  if (!resolved?.ok) return null;
  return {
    role: resolved.role,
    provider: resolved.provider,
    model: resolved.model,
    quality: resolved.quality,
    fallbackCount: resolved.fallbackCount || 0,
    escalated: Boolean(resolved.escalated),
  };
}

export function stripSecrets(value) {
  if (!value || typeof value !== "object") return value;
  const out = { ...value };
  delete out.credentialEnv;
  delete out.apiKey;
  delete out.token;
  return out;
}
