/**
 * AnySearch public-intel client. API key is request-scoped.
 */
export function resolveAnysearchKey(ctx = {}) {
  return String(ctx.anysearchKey || process.env.ANYSEARCH_API_KEY || "").trim();
}

function requestSignal(ctx, fallbackMs) {
  const timeout = AbortSignal.timeout(ctx.timeoutMs ?? fallbackMs);
  return ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
}

export async function fetchIntelBrief(query, kind = "part", ctx = {}) {
  const key = resolveAnysearchKey(ctx);
  if (!key) {
    return { status: "auth_required", detail: "pass ctx.anysearchKey", hits: [], summary: "", notes: [] };
  }
  const fetchImpl = ctx.fetch ?? globalThis.fetch;
  const q = String(query || "").trim().slice(0, 80);
  const item =
    kind === "company"
      ? { query: `"${q}"`, language: "zh-CN", zone: "cn", max_results: 6 }
      : { query: `${q} datasheet 规格书`, language: "zh-CN", zone: "cn", max_results: 6 };
  const res = await fetchImpl("https://api.anysearch.com/v1/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Anysearch-Client": "electronics-agent-platform/0.4",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(item),
    signal: requestSignal(ctx, 20_000),
  });
  if (!res.ok) throw new Error(`公开资料失败（${res.status}）`);
  const json = await res.json();
  if (json.code !== undefined && json.code !== 0) throw new Error(json.message || "公开资料失败");
  const hits = (json.data?.results || [])
    .map((r) => ({
      title: String(r.title || "").trim(),
      url: String(r.url || "").trim(),
      snippet: String(r.content || r.snippet || "").replace(/\s+/g, " ").trim().slice(0, 280),
    }))
    .filter((h) => h.title || h.snippet)
    .slice(0, 8);
  return {
    status: hits.length ? "ok" : "empty",
    summary: hits[0]?.snippet || hits[0]?.title || "",
    notes: hits.map((h) => h.snippet).filter((s) => s.length > 24).slice(0, 6),
    hits,
  };
}
