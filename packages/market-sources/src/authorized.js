/**
 * Authorized distributor API stubs (Mouser / DigiKey).
 * Keys come from ctx only. No key → auth_required, never invent offers.
 */
export function resolveMouserKey(ctx = {}) {
  return String(ctx.mouserKey || process.env.MOUSER_API_KEY || "").trim();
}

export function resolveDigikeyKey(ctx = {}) {
  return String(ctx.digikeyKey || process.env.DIGIKEY_API_KEY || "").trim();
}

function requestSignal(ctx, fallbackMs) {
  const timeout = AbortSignal.timeout(ctx.timeoutMs ?? fallbackMs);
  return ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
}

export async function fetchMouserOffers(mpn, ctx = {}) {
  const key = resolveMouserKey(ctx);
  if (!key) {
    return {
      status: "auth_required",
      detail: "pass ctx.mouserKey (do not read business project files)",
    };
  }
  const fetchImpl = ctx.fetch ?? globalThis.fetch;
  const res = await fetchImpl(
    `https://api.mouser.com/api/v1/search/keyword?apiKey=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ SearchByKeywordRequest: { keyword: mpn, records: 20, startingRecord: 0 } }),
      signal: requestSignal(ctx, 20_000),
    },
  );
  if (!res.ok) return { status: "error", detail: `Mouser API ${res.status}` };
  const body = await res.json();
  const parts = body.SearchResults?.Parts ?? [];
  const offers = parts.map((p) => {
    const pb = p.PriceBreaks ?? [];
    const first = pb[0]?.Price ?? "";
    return {
      sourceKey: "findchips",
      sourceName: "Mouser(官方API)",
      supplier: "Mouser Electronics",
      model: String(p.MouserPartNumber ?? mpn),
      brand: String(p.Manufacturer ?? ""),
      batch: "",
      stock: Number(p.Availability ?? 0) || null,
      price: Number(String(first).replace(/[^0-9.]/g, "")) || null,
      priceBreaks: pb
        .map((b) => ({
          qty: Number(b.Quantity ?? 0),
          price: Number(String(b.Price).replace(/[^0-9.]/g, "")),
        }))
        .filter((b) => b.qty > 0 && b.price > 0),
      package: String(p.Style ?? ""),
      warehouse: "authorized(API)",
      note: "USD; 官方API",
      date: new Date().toISOString().slice(0, 10),
      url: String(p.DataSheetUrl ?? "https://www.mouser.com"),
      currency: "USD",
    };
  });
  if (!offers.length) return { status: "empty", detail: "Mouser 无匹配" };
  return { status: "ok", offers };
}

export async function fetchDigikeyOffers(mpn, ctx = {}) {
  const key = resolveDigikeyKey(ctx);
  if (!key) {
    return { status: "auth_required", detail: "pass ctx.digikeyKey" };
  }
  return { status: "error", detail: "DigiKey OAuth 适配尚未实现，请先用 findchips" };
}
