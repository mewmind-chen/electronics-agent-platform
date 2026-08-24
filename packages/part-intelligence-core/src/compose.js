/**
 * Deterministic business report composer.
 * Only cites existing claims / evidence. Never invents market facts.
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

function cite(id) {
  return id ? ` 〔${id}〕` : "";
}

function firstEvidenceId(result, ...keys) {
  const hit = (result.evidence || []).find((e) => keys.includes(e.sourceKey));
  return hit?.id || result.verdict?.claims?.[0]?.evidenceId || "";
}

export function composePartReport(raw, fallbackMpn = "") {
  const parsed = parsePartResearchResult(normalizePartResult(raw || {}, fallbackMpn));
  if (!parsed.ok) {
    return parseAgentReport({
      markdown: "无法生成报告：研究结果不合法。",
      claimsCited: [],
    }).value;
  }
  const result = { ...parsed.value, ...(raw || {}) };
  const claims = result.verdict?.claims || [];
  const cited = [...new Set(claims.map((c) => c.evidenceId).filter(Boolean))];
  const identity = result.identity;
  const dossier = result.dossier || {};
  const supply = result.supply || {};
  const cards = result.cards || {};
  const state = result.verdict?.state || "未知";
  const unknown = state === "未知" || !cited.length;
  const idEvi = firstEvidenceId(result, "lcsc", "st");
  const supplyEvi = firstEvidenceId(result, "hqew", "findchips", "icnet");

  const lines = [];
  lines.push("# 型号分析报告");
  lines.push("");
  lines.push("## 基础信息");
  lines.push("");
  lines.push(`型号：${result.mpn}`);
  lines.push(`厂家：${identity?.brand || (unknown ? "证据不足" : "未标注")}${identity?.brand ? cite(idEvi) : ""}`);
  lines.push(`分类：${identity?.category || dossier.extra?.family || "证据不足"}`);
  lines.push(`封装：${identity?.package || "证据不足"}`);
  if (result.positioning) lines.push(`定位：${result.positioning}`);
  lines.push("");
  lines.push("## 市场判断");
  lines.push("");
  if (unknown) {
    lines.push("状态：未知");
    lines.push("依据：交叉证据不足，不给出热门/缺货结论。");
  } else {
    lines.push(`状态：${state}（置信度 ${result.verdict.confidence}）`);
    for (const claim of claims) lines.push(`依据：${claim.text}${cite(claim.evidenceId)}`);
    if (cards.hot?.verdict) lines.push(`热度：${cards.hot.verdict}${cite(cited[0])}`);
  }
  lines.push("");
  lines.push("## 供应情况");
  lines.push("");
  if (unknown && supply.offerCount == null && supply.lcscStock == null) {
    lines.push("供应商：证据不足");
    lines.push("风险：无库存数字，不判断紧缺。");
  } else {
    lines.push(`供应商：华强精确挂货 ${supply.offerCount ?? 0} 家${cite(supplyEvi)}`);
    lines.push(`立创现货：${supply.lcscStock ?? "未知"}${cite(idEvi)}`);
    lines.push(`风险：${cards.supply?.verdict || (unknown ? "证据不足" : "见市场判断")}${cite(supplyEvi || cited[0])}`);
  }
  lines.push("");
  lines.push("## 价格趋势");
  lines.push("");
  if (!cards.price || cards.price.level === "unknown") {
    lines.push("趋势：还不能判断涨跌");
    lines.push("依据：没有同口径历史快照，不编涨价。");
  } else {
    lines.push(`趋势：${cards.price.verdict}${cite(idEvi)}`);
    lines.push(`依据：立创 1+ ${cards.price.lcscPrice ?? "未知"}，挂货最低 ${cards.price.minPrice ?? "未知"}${cite(idEvi)}`);
  }
  lines.push("");
  lines.push("## 业务建议");
  lines.push("");
  if (unknown) {
    lines.push("是否值得开发：证据不足，暂不判断。");
    lines.push("目标客户：未知。");
    lines.push("风险提示：补齐身份与至少两个市场源后再报价。");
  } else {
    lines.push(`是否值得开发：${result.recommendation?.action || "人工确认后报价"}`);
    lines.push(`目标客户：${dossier.customers || dossier.extra?.customers || "见应用场景，需业务确认"}`);
    lines.push(`风险提示：${dossier.extra?.notes?.[0] || result.recommendation?.reasoning || "核对完整后缀与封装。"}`);
  }
  lines.push("");
  lines.push("Agent 不写库存、询价或研究报告库。正式落库由业务系统确认。");
  return parseAgentReport({
    markdown: lines.join("\n"),
    claimsCited: cited,
  }).value;
}
