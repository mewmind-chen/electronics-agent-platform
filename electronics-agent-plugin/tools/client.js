/**
 * HTTP client for electronics-agent-platform.
 * Token is read from the process environment only. Never written to disk.
 */
export function agentApiUrl() {
  return String(process.env.AGENT_API_URL || "").trim().replace(/\/+$/, "");
}

export function platformToken() {
  return String(process.env.ELECTRONICS_AGENT_PLATFORM_TOKEN || "").trim();
}

function headers() {
  const token = platformToken();
  const out = { "content-type": "application/json" };
  if (token) out.authorization = `Bearer ${token}`;
  return out;
}

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

function redact(text) {
  return String(text || "")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/ELECTRONICS_AGENT_PLATFORM_TOKEN=\S+/g, "ELECTRONICS_AGENT_PLATFORM_TOKEN=[redacted]");
}

function asError(error, extra = {}) {
  const reason = extra.reason != null ? redact(extra.reason) : extra.reason;
  return jsonSafe({ ok: false, error, candidates: extra.candidates || [], ...extra, ...(reason != null ? { reason } : {}) });
}

function missingConfig() {
  if (!agentApiUrl()) {
    return asError("configuration_error", { reason: "AGENT_API_URL is required" });
  }
  if (!platformToken()) {
    return asError("authentication_configuration_error", { reason: "ELECTRONICS_AGENT_PLATFORM_TOKEN is required" });
  }
  return null;
}

export async function postJson(path, body) {
  const cfg = missingConfig();
  if (cfg) return cfg;

  const url = `${agentApiUrl()}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body || {}),
    });
  } catch (err) {
    return asError("network_error", { reason: err instanceof Error ? err.message : "fetch failed" });
  }

  const payload = await res.json().catch(() => null);
  if (res.status === 401) return asError("unauthorized", payload || {});
  if (!payload || typeof payload !== "object") {
    return asError("invalid_response", { status: res.status });
  }
  if (res.status === 422 || payload.ok === false) {
    return jsonSafe({
      ...payload,
      ok: false,
      error: payload.error || "contract_error",
      candidates: payload.candidates || [],
    });
  }
  if (!res.ok) {
    return asError(payload.error || "http_error", { status: res.status, ...payload });
  }
  if (Array.isArray(payload.candidates) && payload.candidates.length === 0 && (payload.needsAgent || payload.error || payload.reason)) {
    return jsonSafe({
      ...payload,
      ok: false,
      error: payload.error || payload.reason || "agent_unavailable",
      candidates: [],
    });
  }
  return jsonSafe(payload.ok === false ? asError(payload.error || "request_failed", payload) : payload);
}
