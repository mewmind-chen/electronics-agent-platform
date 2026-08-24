/**
 * Model registry. Live smoke is the only way into production.
 * Unverified rows stay candidate with unknown capabilities.
 * No API keys. No official Harness SDK imports.
 */
export const CAPABILITIES = Object.freeze(["json", "toolCalling", "structuredLong", "harness", "vision"]);

export const REQUIRED_BY_ROLE = Object.freeze({
  fast: ["json", "toolCalling", "harness"],
  reasoning: ["json", "toolCalling", "structuredLong", "harness"],
  vision: ["json", "toolCalling", "harness", "vision"],
  long: ["json", "toolCalling", "structuredLong", "harness"],
  premium: ["json", "toolCalling", "structuredLong", "harness"],
});

export const QUALITY_RANK = Object.freeze({ economy: 0, standard: 1, quality: 2 });

const unknownCaps = Object.freeze({
  json: "unknown",
  toolCalling: "unknown",
  structuredLong: "unknown",
  harness: "unknown",
  vision: "n/a",
});

function model(spec) {
  return Object.freeze({
    pool: "candidate",
    quality: "standard",
    health: "unknown",
    verified: false,
    notes: "live smoke unverified",
    ...spec,
    capabilities: Object.freeze({ ...unknownCaps, ...(spec.capabilities || {}) }),
  });
}

/** First-batch candidates only. Production promotion is written by live qualification. */
export const MODEL_CANDIDATES = Object.freeze([
  model({
    id: "opencode-go/deepseek-v4-flash",
    provider: "opencode-go",
    model: "deepseek-v4-flash",
    roles: ["fast"],
    quality: "economy",
    priority: 10,
  }),
  model({
    id: "litellm/free-fast",
    provider: "llm",
    model: "free-fast",
    roles: ["fast"],
    quality: "economy",
    priority: 90,
  }),
  model({
    id: "opencode-go/deepseek-v4-pro",
    provider: "opencode-go",
    model: "deepseek-v4-pro",
    roles: ["reasoning"],
    quality: "standard",
    priority: 10,
  }),
  model({
    id: "opencode-go/qwen3.7-max",
    provider: "opencode-go",
    model: "qwen3.7-max",
    roles: ["reasoning"],
    quality: "standard",
    priority: 20,
    notes: "reasoning fallback; live smoke unverified",
  }),
  model({
    id: "litellm/free-strong",
    provider: "llm",
    model: "free-strong",
    roles: ["reasoning"],
    quality: "economy",
    priority: 90,
  }),
  model({
    id: "opencode-go/kimi-k3",
    provider: "opencode-go",
    model: "kimi-k3",
    roles: ["long"],
    quality: "standard",
    priority: 10,
  }),
  model({
    id: "litellm/free-long",
    provider: "llm",
    model: "free-long",
    roles: ["long"],
    quality: "economy",
    priority: 90,
  }),
  model({
    id: "subscriptions/grok-4.6",
    provider: "grok",
    model: "grok-4.6",
    roles: ["premium"],
    quality: "quality",
    priority: 10,
    notes: "X Premium OAuth via dsh-plugin-subscriptions; not a static secret",
  }),
  model({
    id: "describe-image/glm-4v-flash",
    provider: "describe-image",
    model: "glm-4v-flash",
    roles: ["vision"],
    quality: "economy",
    priority: 10,
    capabilities: { vision: "unknown" },
    notes: "current describe-image backend; agent-model status unverified",
  }),
]);

/** @deprecated alias kept for callers that still import MODEL_REGISTRY */
export const MODEL_REGISTRY = MODEL_CANDIDATES;

export function unknownCapabilities(vision = false) {
  return {
    json: "unknown",
    toolCalling: "unknown",
    structuredLong: "unknown",
    harness: "unknown",
    vision: vision ? "unknown" : "n/a",
  };
}

export function applyQualification(registry, live = [], bindings = []) {
  const byId = new Map((live || []).map((row) => [row.id, row]));
  const bindById = new Map((bindings || []).map((row) => [row.id, row]));
  return registry.map((entry) => {
    const liveRow = byId.get(entry.id);
    const bind = bindById.get(entry.id);
    if (!liveRow) {
      return {
        ...entry,
        providerId: bind?.providerId || entry.provider,
        availability: bind?.availability || "unbound",
        verified: false,
        pool: "candidate",
        capabilities: entry.capabilities,
      };
    }
    const caps = { ...unknownCapabilities(entry.roles.includes("vision")), ...(liveRow.capabilities || {}) };
    const required = REQUIRED_BY_ROLE[entry.roles[0]] || REQUIRED_BY_ROLE.fast;
    const passed = required.every((cap) => caps[cap] === "pass");
    return {
      ...entry,
      providerId: liveRow.providerId || bind?.providerId || entry.provider,
      availability: liveRow.availability || bind?.availability || "unknown",
      verified: Boolean(liveRow.verified && passed),
      pool: liveRow.verified && passed ? "production" : "candidate",
      health: liveRow.health || "unknown",
      capabilities: caps,
      failureReason: liveRow.failureReason || "",
      notes: liveRow.notes || entry.notes,
    };
  });
}

export function capabilityMatrix(registry = MODEL_CANDIDATES) {
  return registry.map((m) => ({
    id: m.id,
    provider: m.provider,
    providerId: m.providerId || m.provider,
    model: m.model,
    roles: m.roles,
    pool: m.pool,
    verified: m.verified,
    availability: m.availability || "unknown",
    health: m.health,
    capabilities: m.capabilities,
    failureReason: m.failureReason || "",
  }));
}

export function meetsCapabilities(entry, role) {
  const required = REQUIRED_BY_ROLE[role] || REQUIRED_BY_ROLE.fast;
  return required.every((cap) => entry.capabilities?.[cap] === "pass");
}

export function inProductionPool(entry) {
  return entry.pool === "production" && entry.verified === true && entry.health !== "down";
}
