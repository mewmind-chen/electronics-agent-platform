/**
 * Company research: GYS + shop + intel, then deterministic frequency stats.
 */
import { parseCompanyResearchRequest, parseCompanyResearchResult } from "@electronics/contracts";
import { runLookupStep, summarizeCompanyInventory } from "@electronics/market-sources";

function nid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeMpn(s) {
  return String(s || "").trim().toUpperCase().replace(/\s+/g, "");
}

export function aggregateProfile(shopRows = [], companies = []) {
  const freq = new Map();
  const brands = new Map();
  for (const row of shopRows) {
    const mpn = normalizeMpn(row.model);
    if (mpn) freq.set(mpn, (freq.get(mpn) || 0) + 1);
    const brand = String(row.brand || "").trim();
    if (brand) brands.set(brand, (brands.get(brand) || 0) + 1);
  }
  for (const c of companies) {
    for (const b of c.brands || []) brands.set(b, (brands.get(b) || 0) + 2);
  }
  const total = shopRows.length || 1;
  const topMpns = [...freq.entries()]
    .filter(([, hits]) => hits >= 3 || hits / total >= 0.1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([mpn, hits]) => ({ mpn, hits }));
  const mainBrands = [...brands.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([brand, hits]) => ({ brand, hits }));
  const stock = summarizeCompanyInventory(shopRows);
  const brandShare = mainBrands[0] ? mainBrands[0].hits / Math.max(1, [...brands.values()].reduce((a, b) => a + b, 0)) : 0;
  return { topMpns, mainBrands, stock, brandShare };
}

export async function researchCompany(input, ctx = {}) {
  const req = parseCompanyResearchRequest(input);
  if (!req.ok) return { ok: false, errors: req.errors };
  const { company, steps } = req.value;
  const evidence = [];
  let companies = [];
  let shopRows = [];
  let intel = null;
  let shopUrl = "";

  for (const step of steps) {
    const result = await runLookupStep(
      { query: company, step, kind: "company", shopUrl, html: input.html },
      ctx,
    );
    if (!result.ok) {
      evidence.push({
        id: nid("evi"),
        sourceKey: step === "intel" ? "intel" : step,
        title: `${company} @ ${step} failed`,
        trust: "low",
        fields: { error: result.error },
      });
      continue;
    }
    if (result.companies?.length) {
      companies = result.companies;
      shopUrl = companies.find((c) => c.matched && c.shopUrl)?.shopUrl || shopUrl;
    }
    if (result.shopRows?.length) shopRows = result.shopRows;
    if (result.intel) intel = result.intel;
    if (result.status === "ok" || result.companies?.length || result.shopRows?.length) {
      evidence.push({
        id: nid("evi"),
        sourceKey: step === "intel" ? "intel" : step,
        url: result.url || "",
        title: `${company} @ ${step}`,
        capturedAt: new Date().toISOString(),
        trust: "medium",
        fields: { status: result.status },
      });
    }
  }

  const evi0 = evidence[0];
  const agg = aggregateProfile(shopRows, companies);
  const mainBrands = agg.mainBrands.map((b) => ({ ...b, evidenceId: evi0?.id }));
  const topMpns = agg.topMpns.map((m) => ({ ...m, evidenceId: evi0?.id }));
  const parsed = parseCompanyResearchResult({
    company,
    companies,
    shopRows,
    evidence,
    profile: {
      identity: { name: company, aliases: companies.map((c) => c.name), companyType: "unknown" },
      companyType: "unknown",
      mainBrands: evi0 ? mainBrands : [],
      topMpns: evi0 ? topMpns : [],
      stockStructure: agg.stock,
      supplyRoute: {},
      fitForUs: { verdict: evi0 ? "待人工判断" : "unknown", reasoning: intel?.summary || "" },
    },
    verdict: {
      state: evi0 ? "画像完成" : "未知",
      score: Math.min(80, topMpns.length * 10 + mainBrands.length * 8),
      confidence: evi0 ? "medium" : "low",
      claims: evi0 ? [{ text: `${company} 已汇总 ${shopRows.length} 行库存`, evidenceId: evi0.id }] : [],
    },
    recommendation: { action: "人工确认是否开发", reasoning: intel?.summary || "" },
  });
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  return { ok: true, ...parsed.value };
}
