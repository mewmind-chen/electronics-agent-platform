/**
 * Deterministic part research. Calls market-sources with request-scoped ctx.
 * Returns PartResearchResult. Does not write a database.
 */
import { parsePartResearchRequest, parsePartResearchResult } from "@electronics/contracts";
import { runLookupStep } from "@electronics/market-sources";
import { analyzePart, buildMarketCards, partPositioning } from "./analyze.js";
import { buildDossier, computeMarketAnalysis, extraKnowledge } from "./knowledge.js";

function nid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function mergeIdentity(a, b) {
  if (!b) return a;
  if (!a) return b;
  return {
    ...a,
    ...Object.fromEntries(Object.entries(b).filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && !v.length))),
    specs: a.specs?.length ? a.specs : b.specs || [],
    applications: [...new Set([...(a.applications || []), ...(b.applications || [])])],
    priceBreaks: a.priceBreaks?.length ? a.priceBreaks : b.priceBreaks || [],
  };
}

export async function researchPart(input, ctx = {}) {
  const req = parsePartResearchRequest(input);
  if (!req.ok) return { ok: false, errors: req.errors };
  const { mpn, steps, goal, holderQty, cost } = req.value;
  const evidence = [];
  const offers = [];
  let identity = null;
  const alts = [];
  const stepResults = [];

  for (const step of steps) {
    const result = await runLookupStep({ query: mpn, step, kind: "part" }, ctx);
    stepResults.push(result);
    if (!result.ok) {
      continue;
    }
    if (result.identity) identity = mergeIdentity(identity, result.identity);
    if (result.alts?.length) alts.push(...result.alts);
    if (result.offers?.length) offers.push(...result.offers);
    if (result.status === "ok") {
      evidence.push({
        id: nid("evi"),
        sourceKey: step === "intel" ? "intel" : step,
        url: result.url || "",
        title: `${mpn} @ ${step}`,
        capturedAt: new Date().toISOString(),
        trust: step === "st" || step === "lcsc" || step === "findchips" ? "high" : "medium",
        mpn,
        fields: { status: result.status, offerCount: result.offers?.length || 0 },
      });
    }
  }

  const dossier = identity ? buildDossier(identity, alts, null) : { extra: extraKnowledge(mpn), headline: extraKnowledge(mpn)?.what || "" };
  const supply = analyzePart(mpn, offers, identity);
  const analysis = computeMarketAnalysis({
    mpn,
    currentOffers: offers,
    internalQuoteCount: Number(ctx.internalQuoteCount || 0),
    snapshots: ctx.snapshots || [],
  });
  const cards = buildMarketCards({
    analysis: supply,
    identity,
    internalQuoteCount: Number(ctx.internalQuoteCount || 0),
    previousLcscPrice: ctx.previousLcscPrice ?? null,
  });
  const positioning = partPositioning(identity);

  const firstEvidence = evidence[0];
  const identityEvidence = evidence.find((e) => e.sourceKey === "lcsc" || e.sourceKey === "st") || firstEvidence;
  const supplyEvidence = evidence.find((e) => e.sourceKey === "hqew" || e.sourceKey === "findchips") || firstEvidence;
  const crossOk = evidence.length >= 2;
  const state = !firstEvidence
    ? "未知"
    : analysis.shortage.score >= 70
      ? "缺货"
      : analysis.hotness.score >= 60
        ? "热门"
        : "平稳";
  const claims = [];
  if (identity && identityEvidence) {
    claims.push({
      text: `${mpn} 身份 ${identity.brand || "未知厂"} / ${identity.category || "未分类"} / ${identity.package || "封装未标"}`,
      evidenceId: identityEvidence.id,
    });
  }
  if (supplyEvidence && (supply.offerCount || supply.lcscStock != null)) {
    claims.push({
      text: `供应：华强精确挂货 ${supply.offerCount} 家，立创现货 ${supply.lcscStock ?? "未知"}`,
      evidenceId: supplyEvidence.id,
    });
  }
  if (firstEvidence && state !== "未知") {
    claims.push({ text: `市场判断 ${state}（交叉源 ${evidence.length}）`, evidenceId: firstEvidence.id });
  }
  if (!crossOk && firstEvidence && state !== "未知") {
    /* single source cannot promote a strong market call */
  }
  const finalState = !firstEvidence || (!crossOk && state !== "未知" && !identity) ? "未知" : state;

  const parsed = parsePartResearchResult({
    mpn,
    identity,
    offers,
    evidence,
    verdict: {
      state: finalState,
      score: Math.max(analysis.hotness.score, analysis.shortage.score),
      confidence: !firstEvidence ? "low" : crossOk ? "medium" : "low",
      claims: finalState === "未知" ? [] : claims,
    },
    recommendation: {
      action: finalState === "未知" ? "补数据后再判断是否开发" : cards.supply.level === "high" ? "谨慎备货，先核交期" : "人工确认后报价",
      reasoning: dossier.headline || positioning || goal || "",
      holderQty,
      cost,
    },
  });
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  return {
    ok: true,
    ...parsed.value,
    dossier,
    analysis,
    supply,
    cards,
    positioning,
    steps: stepResults,
  };
}
