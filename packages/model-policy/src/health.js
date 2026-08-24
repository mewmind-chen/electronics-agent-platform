/**
 * In-memory provider/model health. No secrets stored.
 */
const DEFAULT_COOLDOWN_MS = 30_000;

export function createHealthBook({ now = () => Date.now(), cooldownMs = DEFAULT_COOLDOWN_MS } = {}) {
  const fails = new Map();

  function keyOf(entry) {
    return entry.id || `${entry.provider}/${entry.model}`;
  }

  return {
    markSuccess(entry) {
      fails.delete(keyOf(entry));
    },
    markFailure(entry, error) {
      const kind = classifyProviderError(error);
      if (!isRetryableProviderError(kind)) return;
      fails.set(keyOf(entry), { at: now(), kind });
    },
    isHealthy(entry) {
      if (entry.health === "down") return false;
      const rec = fails.get(keyOf(entry));
      if (!rec) return true;
      return now() - rec.at >= cooldownMs;
    },
    snapshot() {
      return Object.fromEntries(fails);
    },
  };
}

export function classifyProviderError(error) {
  if (!error) return "unknown";
  if (typeof error === "string") {
    if (/429|rate.?limit/i.test(error)) return "429";
    if (/timeout|etimedout|aborterror/i.test(error)) return "timeout";
    if (/unavailable|econnrefused|enotfound|503|502/i.test(error)) return "unavailable";
    return "unknown";
  }
  const status = error.status ?? error.statusCode ?? error.code;
  const message = String(error.message || error.reason || "");
  if (status === 429 || /429|rate.?limit/i.test(message)) return "429";
  if (status === 408 || /timeout|etimedout|aborterror/i.test(message)) return "timeout";
  if (status === 503 || status === 502 || /unavailable|econnrefused|enotfound/i.test(message)) return "unavailable";
  return "unknown";
}

export function isRetryableProviderError(kind) {
  return kind === "429" || kind === "timeout" || kind === "unavailable";
}
