/**
 * Provider Binding / Runtime Catalog.
 *
 * Maps first-batch logical models onto Harness identities observed from
 * dump-config + settings provider *names* (never secrets).
 * Model Policy does not own API keys, OAuth tokens, or baseURLs.
 */
export const HARNESS_PROVIDER_CATALOG = Object.freeze([
  {
    providerId: "opencode-go",
    source: "llm-pi-ai",
    auth: "harness-credentials-ref",
    models: ["deepseek-v4-flash", "deepseek-v4-pro", "qwen3.7-max", "kimi-k3"],
    notes: "Configured under settings.yaml llm-pi-ai.providers.opencode-go",
  },
  {
    providerId: "modlens-opencode-go",
    source: "agent-default-model",
    auth: "harness-credentials-ref",
    models: ["deepseek-v4-flash"],
    notes: "Desktop default model identity; alias of the opencode-go route",
  },
  {
    providerId: "llm",
    source: "llm-pi-ai",
    auth: "harness-credentials-ref",
    models: ["free-fast", "free-strong", "free-long"],
    notes: "LiteLLM OpenAI-compatible route declared as provider id llm",
  },
  {
    providerId: "grok",
    source: "dsh-plugin-subscriptions",
    auth: "oauth-subscription",
    models: ["grok-4.6"],
    notes: "X Premium OAuth via subscriptions plugin. Not a static secret binding.",
  },
  {
    providerId: "describe-image",
    source: "describe-image-plugin",
    auth: "plugin-settings",
    models: ["glm-4v-flash"],
    notes: "Image-describe backend, not proven as a Harness agent model",
  },
  {
    providerId: "deepseek-official",
    source: "dsh-llm-deepseek",
    auth: "harness-credentials-ref",
    models: ["deepseek-v4-flash", "deepseek-chat", "deepseek-v4-flash-vision-exp"],
    notes: "Present on headless/desktop default model plugin; vision-exp is the image-capable catalog model",
  },
]);

const BINDINGS = Object.freeze([
  {
    id: "opencode-go/deepseek-v4-flash",
    providerId: "opencode-go",
    model: "deepseek-v4-flash",
    aliases: [{ providerId: "modlens-opencode-go", model: "deepseek-v4-flash" }],
  },
  { id: "opencode-go/deepseek-v4-pro", providerId: "opencode-go", model: "deepseek-v4-pro" },
  { id: "opencode-go/qwen3.7-max", providerId: "opencode-go", model: "qwen3.7-max" },
  { id: "opencode-go/kimi-k3", providerId: "opencode-go", model: "kimi-k3" },
  { id: "litellm/free-fast", providerId: "llm", model: "free-fast" },
  { id: "litellm/free-strong", providerId: "llm", model: "free-strong" },
  { id: "litellm/free-long", providerId: "llm", model: "free-long" },
  { id: "subscriptions/grok-4.6", providerId: "grok", model: "grok-4.6" },
  { id: "deepseek-official/deepseek-v4-flash-vision-exp", providerId: "deepseek-official", model: "deepseek-v4-flash-vision-exp" },
  { id: "describe-image/glm-4v-flash", providerId: "describe-image", model: "glm-4v-flash" },
]);

export function providerBindings() {
  return BINDINGS.map((row) => {
    const catalog = HARNESS_PROVIDER_CATALOG.find((p) => p.providerId === row.providerId);
    const modelKnown = Boolean(catalog && catalog.models.includes(row.model));
    return {
      id: row.id,
      providerId: row.providerId,
      model: row.model,
      aliases: row.aliases || [],
      availability: catalog ? (modelKnown ? "bound" : "model_missing") : "unbound",
      source: catalog?.source || "unknown",
      auth: catalog?.auth || "unknown",
      notes: catalog?.notes || "",
    };
  });
}

export function bindingFor(id) {
  return providerBindings().find((b) => b.id === id) || null;
}

/** Router-facing projection. No secrets. */
export function routerView(entry, binding, live) {
  return {
    providerId: live?.providerId || binding?.providerId || entry.provider,
    model: entry.model,
    availability: live?.availability || binding?.availability || "unbound",
    capabilities: entry.capabilities,
    verified: Boolean(entry.verified),
  };
}
