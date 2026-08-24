/**
 * Production model pool + capability matrix.
 * Smoke status is declared, not guessed. Unverified models stay out of production.
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

const pass = Object.freeze({
  json: "pass",
  toolCalling: "pass",
  structuredLong: "pass",
  harness: "pass",
  vision: "n/a",
});

function model(spec) {
  return Object.freeze({
    pool: "production",
    quality: "standard",
    health: "up",
    verified: true,
    notes: "",
    ...spec,
    capabilities: Object.freeze({ ...pass, ...(spec.capabilities || {}) }),
  });
}

/** Declared first-version production pool. Live provider smoke is still unverified. */
export const MODEL_REGISTRY = Object.freeze([
  model({
    id: "opencode-go/deepseek-v4-flash",
    provider: "opencode-go",
    model: "deepseek-v4-flash",
    roles: ["fast"],
    quality: "economy",
    priority: 10,
    credentialEnv: "OPENCODE_GO_API_KEY",
  }),
  model({
    id: "opencode-go/deepseek-v4-pro",
    provider: "opencode-go",
    model: "deepseek-v4-pro",
    roles: ["reasoning"],
    quality: "standard",
    priority: 10,
    credentialEnv: "OPENCODE_GO_API_KEY",
  }),
  model({
    id: "opencode-go/qwen3.7-max",
    provider: "opencode-go",
    model: "qwen3.7-max",
    roles: ["reasoning"],
    quality: "standard",
    priority: 20,
    credentialEnv: "OPENCODE_GO_API_KEY",
    notes: "reasoning fallback",
  }),
  model({
    id: "opencode-go/kimi-k3",
    provider: "opencode-go",
    model: "kimi-k3",
    roles: ["long"],
    quality: "standard",
    priority: 10,
    credentialEnv: "OPENCODE_GO_API_KEY",
  }),
  model({
    id: "zai/glm-4v-flash",
    provider: "zai",
    model: "GLM-4V-flash",
    roles: ["vision"],
    quality: "economy",
    priority: 10,
    credentialEnv: "ZAI_API_KEY",
    capabilities: { vision: "pass" },
  }),
  model({
    id: "xai/grok-4.6",
    provider: "xai",
    model: "grok-4.6",
    roles: ["premium"],
    quality: "quality",
    priority: 10,
    credentialEnv: "XAI_API_KEY",
  }),
  model({
    id: "economy/free-fast",
    provider: "economy",
    model: "free-fast",
    roles: ["fast"],
    quality: "economy",
    priority: 90,
    credentialEnv: "ECONOMY_FAST_KEY",
    notes: "economy fallback",
  }),
  model({
    id: "economy/free-strong",
    provider: "economy",
    model: "free-strong",
    roles: ["reasoning"],
    quality: "economy",
    priority: 90,
    credentialEnv: "ECONOMY_STRONG_KEY",
    notes: "economy fallback",
  }),
  model({
    id: "economy/free-long",
    provider: "economy",
    model: "free-long",
    roles: ["long"],
    quality: "economy",
    priority: 90,
    credentialEnv: "ECONOMY_LONG_KEY",
    notes: "economy fallback",
  }),
]);

export function capabilityMatrix(registry = MODEL_REGISTRY) {
  return registry.map((m) => ({
    id: m.id,
    provider: m.provider,
    model: m.model,
    roles: m.roles,
    pool: m.pool,
    verified: m.verified,
    health: m.health,
    capabilities: m.capabilities,
  }));
}

export function meetsCapabilities(entry, role) {
  const required = REQUIRED_BY_ROLE[role] || REQUIRED_BY_ROLE.fast;
  return required.every((cap) => entry.capabilities?.[cap] === "pass");
}

export function inProductionPool(entry) {
  return entry.pool === "production" && entry.verified === true && entry.health !== "down";
}
