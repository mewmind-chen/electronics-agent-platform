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
import { sourceConfigured } from "./readiness.js";

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

function fetchMarkdown(url, ctx, options = {}) {
  if (typeof ctx.scrapeMarkdown === "function") return ctx.scrapeMarkdown(url, options);
  return scrapeMarkdown(url, { ...ctx, ...options });
}

function hasNoMatchNotice(markdown) {
  return /无匹配|未找到|暂无|没有找到|无货|无结果|no\s+results?|not\s+found/i.test(String(markdown || ""));
}

function classifyError(error) {
  const message = String(error?.message || error || "");
  return /abort|timeout|timed out|network|fetch|firecrawl|公开资料失败|\bHTTP\b|\bAPI\s+\d{3}\b/i.test(message)
    ? "DEGRADED"
    : "ERROR";
}

function dataCount(result = {}) {
  return Math.max(
    result.offers?.length || 0,
    result.companies?.length || 0,
    result.shopRows?.length || 0,
    result.intel?.hits?.length || 0,
    result.identity ? 1 : 0,
  );
}

function parsedStatus(sourceKey, rows, markdown) {
  if (!rows.length) return hasNoMatchNotice(markdown) ? "EMPTY" : "DEGRADED";
  const health = assessParseHealth(sourceKey, rows);
  return health.healthy ? "OK" : "DEGRADED";
}

function traceResult(result, sourceKey, ctx, startedAt) {
  const status = String(result?.status || (result?.ok ? "OK" : "ERROR")).toUpperCase();
  const reason = result?.degradationReason || result?.detail || result?.error || undefined;
  const configured = sourceConfigured(sourceKey, ctx);
  return {
    ...result,
    status,
    sourceTrace: {
      source: sourceKey,
      configured,
      called: result?.called ?? status !== "AUTH_REQUIRED",
      status,
      url: result?.url || "",
      latencyMs: Math.max(0, Date.now() - startedAt),
      dataCount: dataCount(result),
      ...(reason ? { degradationReason: String(reason).slice(0, 280) } : {}),
    },
  };
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
  const searchMd = await fetchMarkdown(searchUrl, ctx, { waitFor: 2500 });
  const listing = parseLcscSearchListing(searchMd, query);
  const itemUrl = listing?.url || parseLcscSearchItemUrl(searchMd, query);
  if (!itemUrl && !listing) {
    return {
      ok: true,
      step: "lcsc",
      status: hasNoMatchNotice(searchMd) ? "EMPTY" : "DEGRADED",
      url: searchUrl,
      detail: hasNoMatchNotice(searchMd) ? "立创搜索未找到商品" : "立创搜索抓取成功但 parser 未确认商品结果",
    };
  }
  let item = listing;
  if (itemUrl) {
    try {
      const itemMd = await fetchMarkdown(itemUrl, ctx, { waitFor: 2500 });
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
  if (!item) {
    return {
      ok: true,
      step: "lcsc",
      status: "DEGRADED",
      url: searchUrl,
      detail: "立创商品页抓取成功但 parser 未解析到身份或报价",
    };
  }
  return {
    ok: true,
    step: "lcsc",
    status: "OK",
    url: item.url || searchUrl,
    identity: identityFromLcsc(item),
    alts: item.alts,
    offers: [lcscToOffer(item)],
  };
}

async function stepSt(query, ctx) {
  const url = stProductUrl(query);
  if (!url) {
    return { ok: true, step: "st", status: "EMPTY", called: false, url: "", detail: "目前只自动打开 STM32 的 ST 原厂页" };
  }
  const md = await fetchMarkdown(url, ctx, { waitFor: 2000 });
  const parsed = parseStApplications(md);
  if (!parsed.applications.length && !parsed.active) {
    return { ok: true, step: "st", status: "DEGRADED", url, detail: "原厂页抓取成功但 parser 未解析到应用领域" };
  }
  return {
    ok: true,
    step: "st",
    status: "OK",
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
  const md = await fetchMarkdown(url, ctx, { waitFor: 3000 });
  const rows = parseHqewOffers(md);
  const yun = yunPriceFromHqew(md);
  const status = parsedStatus("hqew", rows, md);
  return {
    ok: true,
    step: "hqew",
    status,
    url,
    detail:
      status === "OK" && yun != null
        ? `云价格 ¥${yun}`
        : status === "EMPTY"
          ? "华强页面明确无匹配挂货"
          : "华强页面抓取成功但 parser/health 未确认结构化挂货行",
    offers: rows.slice(0, 40).map((row) => hqewToOffer(row, url)),
  };
}

async function stepGys(query, ctx) {
  const url = `https://gys.hqew.com/search/${enc(query)}.html`;
  const md = await fetchMarkdown(url, ctx, { waitFor: 3000 });
  const companies = parseGysCompanies(md, query);
  const status = companies.length ? "OK" : hasNoMatchNotice(md) ? "EMPTY" : "DEGRADED";
  return {
    ok: true,
    step: "gys",
    status,
    url,
    ...(status === "DEGRADED" ? { detail: "供应商页面抓取成功但 parser 未解析到公司" } : {}),
    companies,
  };
}

async function stepShop(shopUrl, ctx) {
  if (!shopUrl) {
    return { ok: true, step: "shop", status: "EMPTY", called: false, url: "", detail: "供应商搜索没有商铺链接" };
  }
  const base = shopUrl.replace(/^http:\/\//, "https://").replace(/\/$/, "");
  const productUrl = `${base}/product`;
  let used = productUrl;
  let md = "";
  try {
    md = await fetchMarkdown(productUrl, ctx, { waitFor: 2500 });
  } catch {
    used = base;
    md = await fetchMarkdown(base, ctx, { waitFor: 2500 });
  }
  let rows = parseShopInventory(md);
  if (!rows.length && used !== base) {
    used = base;
    md = await fetchMarkdown(base, ctx, { waitFor: 2500 });
    rows = parseShopInventory(md);
  }
  const supplier = base.replace(/^https?:\/\//, "").split(".")[0] || "";
  const status = rows.length ? "OK" : hasNoMatchNotice(md) ? "EMPTY" : "DEGRADED";
  return {
    ok: true,
    step: "shop",
    status,
    url: used,
    ...(status === "DEGRADED" ? { detail: "商铺页面抓取成功但 parser 未解析到库存行" } : {}),
    shopRows: rows.slice(0, 40),
    offers: rows.slice(0, 40).map((row) => shopToOffer(row, used, supplier)),
  };
}

/**
 * @param {{ query: string, step: string, shopUrl?: string, kind?: "part"|"company", html?: string }} input
 * @param {{ firecrawlKey?: string, anysearchKey?: string, icnetCookie?: string, fetch?: Function }} ctx
 */
async function runLookupStepInternal(input, ctx = {}) {
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
        status: intel.status === "ok" ? "OK" : intel.status === "auth_required" ? "AUTH_REQUIRED" : "EMPTY",
        url: intel.hits?.[0]?.url || "",
        intel,
        detail: intel.summary || intel.detail,
      };
    } catch (err) {
      return {
        ok: false,
        step,
        status: classifyError(err),
        error: err instanceof Error ? err.message : "公开资料失败",
      };
    }
  }

  if (step === "icnet") {
    const parsed = icnetAuthOrParse(input.html, query, ctx);
    const status = parsed.status === "ok" ? "OK" : parsed.status === "auth_required" ? "AUTH_REQUIRED" : "DEGRADED";
    return {
      ok: status === "OK",
      step: "icnet",
      ...parsed,
      status,
      ...(status === "DEGRADED" ? { detail: parsed.detail || "IC交易网 parser 未解析到结构化挂货行" } : {}),
    };
  }

  const firecrawlNotNeeded = (step === "shop" && !input.shopUrl) || (step === "st" && !stProductUrl(query));
  if (step !== "intel" && !firecrawlNotNeeded && !resolveFirecrawlKey(ctx) && !ctx.scrapeMarkdown) {
    return {
      ok: false,
      step,
      status: "AUTH_REQUIRED",
      error: "查询服务暂不可用（缺少 firecrawlKey）",
    };
  }

  try {
    if (step === "lcsc") return await stepLcsc(query, ctx);
    if (step === "st") return await stepSt(query, ctx);
    if (step === "hqew") return await stepHqew(query, ctx);
    if (step === "gys") return await stepGys(query, ctx);
    if (step === "findchips") {
      const url = `https://www.findchips.com/search/${enc(query)}`;
      const md = await fetchMarkdown(url, ctx, { waitFor: 3000 });
      const offers = parseFindchipsOffers(md, query);
      const status = parsedStatus("findchips", offers, md);
      return {
        ok: true,
        step: "findchips",
        status,
        url,
        ...(status === "OK" || status === "EMPTY"
          ? {}
          : { detail: "Findchips 页面抓取成功但 parser 未解析到供应商报价" }),
        offers,
      };
    }
    return await stepShop(String(input.shopUrl || ""), ctx);
  } catch (err) {
    return {
      ok: false,
      step,
      status: classifyError(err),
      error: err instanceof Error ? err.message : "查询失败",
    };
  }
}

/**
 * Public lookup boundary. Every attempted source returns a safe, normalized
 * source trace so callers can distinguish auth, fetch, parser, empty, and
 * program failures without inspecting credentials.
 */
export async function runLookupStep(input, ctx = {}) {
  const sourceKey = String(input?.step || "");
  const startedAt = Date.now();
  try {
    const result = await runLookupStepInternal(input, ctx);
    return traceResult(result, sourceKey, ctx, startedAt);
  } catch (err) {
    return traceResult(
      {
        ok: false,
        step: sourceKey,
        status: "ERROR",
        error: err instanceof Error ? err.message : "查询程序异常",
      },
      sourceKey,
      ctx,
      startedAt,
    );
  }
}

export function healthForStep(result) {
  if (!result?.ok || ["AUTH_REQUIRED", "DEGRADED", "ERROR"].includes(result?.status)) {
    return {
      sourceKey: result?.step,
      healthy: false,
      offerCount: dataCount(result),
      issues: [result?.degradationReason || result?.detail || result?.error || result?.status || "step failed"],
      status: result?.status || "ERROR",
    };
  }
  if (["intel", "st", "gys"].includes(result.step)) {
    return {
      sourceKey: result.step,
      healthy: true,
      offerCount: dataCount(result),
      completeness: null,
      issues: [],
      status: result.status || "OK",
    };
  }
  const health = assessParseHealth(result.step, result.offers ?? []);
  return { ...health, status: result.status || "OK" };
}
