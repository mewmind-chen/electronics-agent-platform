/**
 * Firecrawl scrape. Credentials are function arguments only.
 * No module-level mutable key. No Grok-sandbox or business-project path probes.
 */
export function resolveFirecrawlKey(ctx = {}) {
  const fromArg = String(ctx.firecrawlKey || "").trim();
  if (fromArg) return fromArg;
  return String(process.env.FIRECRAWL_API_KEY || process.env.FC_API_KEY || "").trim();
}

export async function scrapeMarkdown(url, ctx = {}) {
  const key = resolveFirecrawlKey(ctx);
  if (!key) throw new Error("firecrawl key missing (pass ctx.firecrawlKey)");
  const waitFor = ctx.waitFor ?? 2800;
  const fetchImpl = ctx.fetch ?? globalThis.fetch;
  const res = await fetchImpl("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      waitFor,
    }),
    signal: AbortSignal.timeout(ctx.timeoutMs ?? 60_000),
  });
  if (!res.ok) throw new Error(`抓取失败（${res.status}）`);
  const body = await res.json();
  const md = body.data?.markdown || "";
  if (!body.success || !md) throw new Error("页面无内容");
  return md;
}
