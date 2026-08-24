/**
 * Request-scoped market lookup.
 * Every scrape/search call receives ctx; nothing reads a module-level key.
 */
import { scrapeMarkdown, resolveFirecrawlKey } from "./firecrawl.js";
import {
  parseGysCompanies,
  parseHqewOffers,
  parseLcscItem,
  parseLcscSearchItemUrl,
  parseLcscSearchListing,
  parseShopInventory,
  parseStApplications,
  stProductUrl,
} from "./md-parse.js";
import { parseFindchipsOffers } from "./findchips.js";
import { fetchIntelBrief } from "./anysearch.js";
import { icnetAuthOrParse } from "./icnet.js";
import { assessParseHealth } from "./health.js";

export const MARKET_STEPS = Object.freeze([
  "lcsc",
  "st",
  "hqew",
  "gys",
  "shop",
  "intel",
  "icnet",
  "findchips",
]);

function enc(v) {
  return encodeURIComponent(v);
}

function yunPriceFromHqew(md) {
  const m = String(md).match(/云价格[：:]\s*￥\s*([\d.]+)/);
  return m ? Number(m[1]) : null;
}

function lcscToOffer(item) {
  return {
    sourceKey: "lcsc",
    sourceName: "立创商城",
    supplier: "立创商城",
    model: item.mpn,
    brand: item.brand,
    batch: "",
    stock: item.stock,
    price: item.priceBreaks[0]?.price ?? null,
    priceBreaks: item.priceBreaks,
    package: item.package,
    warehouse: "立创自营",
    note: item.category,
    date: "",
    url: item.url,
  };
}

function hqewToOffer(o, url) {
  return {
    sourceKey: "hqew",
    sourceName: "华强挂货",
    supplier: o.supplier,
    model: o.model,
    brand: o.brand,
    batch: o.batch,
    stock: o.stock,
    price: o.price,
    package: o.package,
    warehouse: o.warehouse,
    note: o.note,
    date: o.date,
    url,
  };
}

function shopToOffer(row, url, supplier) {
  return {
    sourceKey: "shop",
    sourceName: "商铺库存",
    supplier,
    model: row.model,
    brand: row.brand,
    batch: row.batch,
    stock: row.stock,
    price: null,
    package: row.package,
    warehouse: "",
    note: row.category,
    date: row.date,
    url,
  };
}

function identityFromLcsc(item) {
  return {
    mpn: item.mpn,
    brand: item.brand,
    category: item.category,
    package: item.package,
    desc: item.desc,
    summary: item.summary,
    features: item.features,
    lcscCode: item.lcscCode,
    specs: item.specs,
    applications: [],
    longevity: "",
    active: false,
    lcscStock: item.stock,
    priceBreaks: item.priceBreaks,
    lcscUrl: item.url,
    stUrl: "",
    imageUrl: item.imageUrl || "",
  };
}

async function stepLcsc(query, ctx) {
  const searchUrl = `https://so.szlcsc.com/global.html?k=${enc(query)}`;
  const searchMd = await scrapeMarkdown(searchUrl, { ...ctx, waitFor: 2500 });
  const listing = parseLcscSearchListing(searchMd, query);
  const itemUrl = listing?.url || parseLcscSearchItemUrl(searchMd, query);
  if (!itemUrl && !listing) {
    return { ok: true, step: "lcsc", status: "empty", url: searchUrl, detail: "立创搜索未找到商品" };
  }
  let item = listing;
  if (itemUrl) {
    try {
      const itemMd = await scrapeMarkdown(itemUrl, { ...ctx, waitFor: 2500 });
      item = parseLcscItem(itemMd, query, itemUrl);
      if (listing) {
        item = {
          ...item,
          brand: item.brand || listing.brand,
          category: item.category || listing.category,
          package: item.package || listing.package,
          stock: item.stock ?? listing.stock,
          priceBreaks: item.priceBreaks.length ? item.priceBreaks : listing.priceBreaks,
        };
      }
    } catch {
      /* listing fallback */
    }
  }
  if (!item) return { ok: true, step: "lcsc", status: "empty", url: searchUrl };
  return {
    ok: true,
    step: "lcsc",
    status: "ok",
    url: item.url || searchUrl,
    identity: identityFromLcsc(item),
    alts: item.alts,
    offers: [lcscToOffer(item)],
  };
}

async function stepSt(query, ctx) {
  const url = stProductUrl(query);
  if (!url) {
    return { ok: true, step: "st", status: "skipped", url: "", detail: "目前只自动打开 STM32 的 ST 原厂页" };
  }
  const md = await scrapeMarkdown(url, { ...ctx, waitFor: 2000 });
  const parsed = parseStApplications(md);
  if (!parsed.applications.length && !parsed.active) {
    return { ok: true, step: "st", status: "empty", url, detail: "原厂页未解析到应用领域" };
  }
  return {
    ok: true,
    step: "st",
    status: "ok",
    url,
    identity: {
      mpn: query.toUpperCase(),
      brand: "",
      category: "",
      package: "",
      desc: parsed.desc,
      summary: "",
      features: "",
      lcscCode: "",
      specs: [],
      applications: parsed.applications,
      longevity: parsed.longevity,
      active: parsed.active,
      lcscStock: null,
      priceBreaks: [],
      lcscUrl: "",
      stUrl: url,
    },
  };
}

async function stepHqew(query, ctx) {
  const url = `https://s.hqew.com/${enc(query)}.html`;
  const md = await scrapeMarkdown(url, { ...ctx, waitFor: 3000 });
  const rows = parseHqewOffers(md);
  const yun = yunPriceFromHqew(md);
  return {
    ok: true,
    step: "hqew",
    status: rows.length ? "ok" : "empty",
    url,
    detail: yun != null ? `云价格 ¥${yun}` : undefined,
    offers: rows.slice(0, 40).map((row) => hqewToOffer(row, url)),
  };
}

async function stepGys(query, ctx) {
  const url = `https://gys.hqew.com/search/${enc(query)}.html`;
  const md = await scrapeMarkdown(url, { ...ctx, waitFor: 3000 });
  const companies = parseGysCompanies(md, query);
  return {
    ok: true,
    step: "gys",
    status: companies.length ? "ok" : "empty",
    url,
    companies,
  };
}

async function stepShop(shopUrl, ctx) {
  if (!shopUrl) {
    return { ok: true, step: "shop", status: "skipped", url: "", detail: "供应商搜索没有商铺链接" };
  }
  const base = shopUrl.replace(/^http:\/\//, "https://").replace(/\/$/, "");
  const productUrl = `${base}/product`;
  let used = productUrl;
  let md = "";
  try {
    md = await scrapeMarkdown(productUrl, { ...ctx, waitFor: 2500 });
  } catch {
    used = base;
    md = await scrapeMarkdown(base, { ...ctx, waitFor: 2500 });
  }
  let rows = parseShopInventory(md);
  if (!rows.length && used !== base) {
    used = base;
    md = await scrapeMarkdown(base, { ...ctx, waitFor: 2500 });
    rows = parseShopInventory(md);
  }
  const supplier = base.replace(/^https?:\/\//, "").split(".")[0] || "";
  return {
    ok: true,
    step: "shop",
    status: rows.length ? "ok" : "empty",
    url: used,
    shopRows: rows.slice(0, 40),
    offers: rows.slice(0, 40).map((row) => shopToOffer(row, used, supplier)),
  };
}

/**
 * @param {{ query: string, step: string, shopUrl?: string, kind?: "part"|"company", html?: string }} input
 * @param {{ firecrawlKey?: string, anysearchKey?: string, icnetCookie?: string, fetch?: Function }} ctx
 */
export async function runLookupStep(input, ctx = {}) {
  const query = String(input.query || "").trim().slice(0, 80);
  const step = input.step;
  if (!query) return { ok: false, step, error: "请输入型号或公司名" };
  if (!MARKET_STEPS.includes(step)) return { ok: false, step, error: `unknown step ${step}` };

  if (step === "intel") {
    try {
      const intel = await fetchIntelBrief(query, input.kind === "company" ? "company" : "part", ctx);
      return {
        ok: true,
        step: "intel",
        status: intel.status === "ok" ? "ok" : intel.status === "auth_required" ? "skipped" : "empty",
        url: intel.hits?.[0]?.url || "",
        intel,
        detail: intel.summary || intel.detail,
      };
    } catch (err) {
      return { ok: false, step, error: err instanceof Error ? err.message : "公开资料失败" };
    }
  }

  if (step === "icnet") {
    return {
      ok: true,
      step: "icnet",
      ...icnetAuthOrParse(input.html, query, ctx),
    };
  }

  if (step !== "intel" && !resolveFirecrawlKey(ctx) && !ctx.scrapeMarkdown) {
    return { ok: false, step, error: "查询服务暂不可用（缺少 firecrawlKey）" };
  }

  try {
    if (step === "lcsc") return await stepLcsc(query, ctx);
    if (step === "st") return await stepSt(query, ctx);
    if (step === "hqew") return await stepHqew(query, ctx);
    if (step === "gys") return await stepGys(query, ctx);
    if (step === "findchips") {
      const url = `https://www.findchips.com/search/${enc(query)}`;
      const md = await scrapeMarkdown(url, { ...ctx, waitFor: 3000 });
      const offers = parseFindchipsOffers(md, query);
      return {
        ok: true,
        step: "findchips",
        status: offers.length ? "ok" : "empty",
        url,
        offers,
      };
    }
    return await stepShop(String(input.shopUrl || ""), ctx);
  } catch (err) {
    return { ok: false, step, error: err instanceof Error ? err.message : "查询失败" };
  }
}

export function healthForStep(result) {
  if (!result?.ok) return { healthy: false, issues: [result?.error || "step failed"] };
  return assessParseHealth(result.step, result.offers ?? []);
}
