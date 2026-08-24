/**
 * Deterministic part research. Calls market-sources with request-scoped ctx.
 * Returns PartResearchResult. Does not write a database.
 */
import { parsePartResearchRequest, parsePartResearchResult } from "@electronics/contracts";
import { runLookupStep } from "@electronics/market-sources";
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
      evidence.push({
        id: nid("evi"),
        sourceKey: step === "intel" ? "intel" : step,
        title: `${mpn} @ ${step} failed`,
        trust: "low",
        fields: { error: result.error },
      });
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

  const dossier = identity ? buildDossier(identity, alts, null) : { extra: extraKnowledge(mpn) };
  const analysis = computeMarketAnalysis({
    mpn,
    currentOffers: offers,
    internalQuoteCount: Number(ctx.internalQuoteCount || 0),
    snapshots: ctx.snapshots || [],
  });

  const firstEvidence = evidence[0];
  const state = !firstEvidence ? "未知" : analysis.shortage.score >= 70 ? "缺货" : analysis.hotness.score >= 60 ? "热门" : "平稳";
  const claims =
    state === "未知" || !firstEvidence
      ? []
      : [{ text: `${mpn} 已交叉 ${offers.length} 条市场行`, evidenceId: firstEvidence.id }];

  const parsed = parsePartResearchResult({
    mpn,
    identity,
    offers,
    evidence,
    verdict: {
      state,
      score: Math.max(analysis.hotness.score, analysis.shortage.score),
      confidence: firstEvidence ? "medium" : "low",
      claims,
    },
    recommendation: {
      action: state === "未知" ? "补数据" : "人工确认后报价",
      reasoning: dossier.headline || goal || "",
      holderQty,
      cost,
    },
  });
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  return { ok: true, ...parsed.value, dossier, analysis, steps: stepResults };
}
