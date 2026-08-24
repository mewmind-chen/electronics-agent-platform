/**
 * Deterministic Answer Composer.
 * Reads a validated PartResearchResult. Never adds claims or evidence.
 */
import { parseAgentReport, parsePartResearchResult } from "@electronics/contracts";

export function normalizePartResult(raw, fallbackMpn = "") {
  if (!raw || typeof raw !== "object") return raw;
  const verdictIn = raw.verdict && typeof raw.verdict === "object" ? raw.verdict : {};
  const state = verdictIn.state || "未知";
  const evidence = Array.isArray(raw.evidence) ? raw.evidence : [];
  const claims = Array.isArray(verdictIn.claims) ? verdictIn.claims : [];
  return {
    ...raw,
    mpn: raw.mpn || fallbackMpn,
    evidence,
    verdict: {
      state,
      score: verdictIn.score ?? null,
      confidence: verdictIn.confidence || (state === "未知" ? "low" : "medium"),
      claims: state === "未知" ? [] : claims,
    },
  };
}

function citeList(claims) {
  return (claims || []).map((c) => c.evidenceId).filter(Boolean);
}

export function composePartReport(raw, fallbackMpn = "") {
  const parsed = parsePartResearchResult(normalizePartResult(raw || {}, fallbackMpn));
  if (!parsed.ok) {
    return parseAgentReport({
      markdown: "无法生成报告：研究结果不合法。",
      claimsCited: [],
    }).value;
  }
  const result = parsed.value;
  const claims = result.verdict?.claims || [];
  const cited = citeList(claims);
  const identity = result.identity;
  const lines = [];
  lines.push(`# 型号研究 ${result.mpn}`);
  lines.push("");
  if (identity) {
    const bits = [identity.brand, identity.category, identity.package].filter(Boolean);
    lines.push(`身份：${bits.join(" / ") || "已识别，规格见结果"}`);
    if (identity.summary) lines.push(identity.summary);
  } else {
    lines.push("身份：证据不足，未确认。");
  }
  lines.push("");
  const state = result.verdict?.state || "未知";
  const confidence = result.verdict?.confidence || "low";
  lines.push(`结论：${state}（置信度 ${confidence}）`);
  if (state === "未知" || !cited.length) {
    lines.push("证据不足，不给出市场判断。");
  } else {
    for (const claim of claims) {
      lines.push(`- ${claim.text} 〔${claim.evidenceId}〕`);
    }
  }
  if (result.recommendation?.action) {
    lines.push("");
    lines.push(`建议：${result.recommendation.action}`);
    if (result.recommendation.reasoning) lines.push(result.recommendation.reasoning);
  }
  lines.push("");
  lines.push("Agent 不写库存、询价或研究报告库。正式落库由业务系统确认。");
  return parseAgentReport({
    markdown: lines.join("\n"),
    claimsCited: cited,
  }).value;
}
