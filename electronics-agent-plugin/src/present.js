/**
 * User-facing markdown for plugin tools.
 * Consumes Agent API JSON as-is. Does not import Platform Core or contracts.
 */

function cite(id) {
  return id ? ` 〔${id}〕` : "";
}

function firstEvidenceId(result, ...keys) {
  const hit = (result.evidence || []).find((e) => keys.includes(e.sourceKey));
  return hit?.id || result.verdict?.claims?.[0]?.evidenceId || "";
}

function unknownPart(result) {
  const state = result?.verdict?.state || "未知";
  const claims = result?.verdict?.claims || [];
  const cited = claims.map((c) => c.evidenceId).filter(Boolean);
  return state === "未知" || !cited.length;
}

function presentConfigFailure(raw) {
  const error = raw && typeof raw === "object" ? raw.error : "";
  if (error !== "configuration_error" && error !== "authentication_configuration_error") return "";
  return [
    "# 调用失败",
    "",
    `原因：\`${error}\``,
    "",
    error === "configuration_error"
      ? "请设置环境变量 AGENT_API_URL。"
      : "请设置环境变量 ELECTRONICS_AGENT_PLATFORM_TOKEN。",
    "",
    "Agent 不写库。",
  ].join("\n");
}

export function presentPartMarkdown(raw = {}) {
  const result = raw && typeof raw === "object" ? raw : {};
  const configFail = presentConfigFailure(result);
  if (configFail) return configFail;
  const identity = result.identity || {};
  const dossier = result.dossier || {};
  const supply = result.supply || {};
  const cards = result.cards || {};
  const advice = result.advice || {};
  const biz = result.businessContext || {};
  const claims = result.verdict?.claims || [];
  const cited = [...new Set(claims.map((c) => c.evidenceId).filter(Boolean))];
  const unknown = unknownPart(result);
  const idEvi = firstEvidenceId(result, "lcsc", "st");
  const supplyEvi = firstEvidenceId(result, "hqew", "findchips", "icnet");
  const mpn = result.mpn || "未知";

  const lines = [];
  lines.push("# 型号分析报告");
  lines.push("");
  lines.push("## 基础信息");
  lines.push("");
  lines.push(`型号：${mpn}`);
  lines.push(`厂家：${identity.brand || (unknown ? "证据不足" : "未标注")}${identity.brand ? cite(idEvi) : ""}`);
  lines.push(`分类：${identity.category || dossier.extra?.family || "证据不足"}`);
  lines.push(`封装：${identity.package || "证据不足"}`);
  if (result.positioning) lines.push(`定位：${result.positioning}`);
  lines.push("");
  lines.push("## 公开市场判断");
  lines.push("");
  if (unknown) {
    lines.push("状态：未知");
    lines.push("依据：交叉证据不足，不给出热门/缺货结论。");
  } else {
    lines.push(`状态：${result.verdict.state}（置信度 ${result.verdict.confidence || "medium"}）`);
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
  lines.push("## 内部业务判断");
  lines.push("");
  if (!advice.usedInternal) {
    lines.push("内部上下文：未注入。");
    lines.push("说明：库存/询价须由 Radar 或 Workbench 在请求里传入，Agent 不读业务库。");
  } else {
    if (biz.inventory) {
      lines.push(`库存上下文（${biz.inventory.origin}）：在手 ${biz.inventory.onHand ?? "未知"}，在途 ${biz.inventory.inTransit ?? "未知"}`);
    }
    if (biz.quotation) {
      lines.push(`询价上下文（${biz.quotation.origin}）：未完成 ${biz.quotation.openCount ?? 0} 条`);
    }
    lines.push(`内部判断：${advice.internalView || "见上下文"}`);
    lines.push("注意：以上是 internal context，不是公开 evidenceId。");
  }
  lines.push("");
  lines.push("## 综合建议");
  lines.push("");
  lines.push(advice.combined || result.recommendation?.action || (unknown ? "综合建议：先补市场证据。" : "综合建议：按公开市场谨慎报价。"));
  if (unknown && !advice.usedInternal) {
    lines.push("是否值得开发：证据不足，暂不判断。");
    lines.push("目标客户：未知。");
    lines.push("风险提示：补齐身份与至少两个市场源后再报价。");
  } else {
    lines.push(`是否值得开发：${result.recommendation?.action || advice.action || "人工确认后报价"}`);
    lines.push(`目标客户：${dossier.customers || dossier.extra?.customers || "见应用场景，需业务确认"}`);
    lines.push(`风险提示：${dossier.extra?.notes?.[0] || "核对完整后缀与封装。内部数字不得写成公开证据。"}`);
  }
  lines.push("");
  lines.push("Agent 不写库存、询价或研究报告库。正式落库由业务系统确认。");
  return lines.join("\n");
}

function candidateCells(row) {
  return [
    row.mpn || "",
    row.brand || "",
    row.qty == null ? "" : String(row.qty),
    row.dateCode || "",
    row.price == null ? "" : String(row.price),
  ];
}

export function presentImportMarkdown(raw = {}, args = {}) {
  const result = raw && typeof raw === "object" ? raw : {};
  const configFail = presentConfigFailure(result);
  if (configFail) return configFail;
  const sourceType = result.sourceType || args.sourceType || "unknown";
  const error = result.error || result.reason || "";
  const candidates = Array.isArray(result.candidates) ? result.candidates : [];

  if (error === "vision_unavailable" || (result.ok === false && sourceType === "image" && candidates.length === 0 && /vision/i.test(String(error)))) {
    return [
      "# 导入失败",
      "",
      `来源：${sourceType}`,
      "原因：`vision_unavailable`",
      "",
      "未生成任何候选行。禁止伪造识别结果。",
      "",
      "Agent 不写库。确认导入由业务系统完成。",
    ].join("\n");
  }

  if (result.ok === false && candidates.length === 0) {
    return [
      "# 导入失败",
      "",
      `来源：${sourceType}`,
      `原因：\`${error || "unknown"}\``,
      "",
      "未生成任何候选行。禁止伪造识别结果。",
      "",
      "Agent 不写库。确认导入由业务系统完成。",
    ].join("\n");
  }

  const lines = [];
  lines.push("# 导入候选");
  lines.push("");
  lines.push(`来源：${sourceType}`);
  lines.push(`候选 ${candidates.length} 行。以下是提案，不是已入库记录。`);
  lines.push("");
  lines.push("| 型号 | 品牌 | 数量 | 批次 | 价格 |");
  lines.push("|---|---|---|---|---|");
  if (!candidates.length) {
    lines.push("| （未生成任何候选） |  |  |  |  |");
  } else {
    for (const row of candidates) {
      lines.push(`| ${candidateCells(row).join(" | ")} |`);
    }
  }
  lines.push("");
  lines.push("待确认：请在业务系统人工确认后再导入。Agent 不写库，也不调用 confirmImport。");
  return lines.join("\n");
}

function brandedList(rows, key) {
  if (!Array.isArray(rows) || !rows.length) return "未知（无 evidence，不编造）";
  return rows
    .map((row) => {
      const label = row[key] || row.brand || row.mpn || "";
      return `${label}${cite(row.evidenceId)}`;
    })
    .filter(Boolean)
    .join("、") || "未知（无 evidence，不编造）";
}

export function presentCompanyMarkdown(raw = {}) {
  const result = raw && typeof raw === "object" ? raw : {};
  const configFail = presentConfigFailure(result);
  if (configFail) return configFail;
  const profile = result.profile || {};
  const identity = profile.identity || {};
  const company = result.company || identity.name || "未知";
  const companyType = identity.companyType || profile.companyType || "unknown";
  const evidence = Array.isArray(result.evidence) ? result.evidence : [];
  const claims = result.verdict?.claims || [];
  const unknown = !evidence.length || result.verdict?.state === "未知";

  const lines = [];
  lines.push("# 公司分析报告");
  lines.push("");
  lines.push("## 基础信息");
  lines.push("");
  lines.push(`公司：${company}`);
  lines.push(`类型：${unknown || companyType === "unknown" ? "未知" : companyType}${cite(evidence[0]?.id)}`);
  lines.push("");
  lines.push("## 经营事实");
  lines.push("");
  lines.push(`主品牌：${brandedList(profile.mainBrands, "brand")}`);
  lines.push(`热门型号：${brandedList(profile.topMpns, "mpn")}`);
  if (Array.isArray(result.shopRows) && result.shopRows.length) {
    lines.push(`库存行：${result.shopRows.length} 行（来自已引用源，不是内部库写入）`);
  }
  lines.push("");
  lines.push("## 证据");
  lines.push("");
  if (!evidence.length) {
    lines.push("无可用 evidence。未知事实保持未知，不编造注册资本、联系人或代理线。");
  } else {
    for (const item of evidence.slice(0, 8)) {
      lines.push(`- ${item.id}: ${item.title || item.sourceKey || "source"}${item.url ? ` (${item.url})` : ""}`);
    }
    for (const claim of claims) {
      lines.push(`依据：${claim.text}${cite(claim.evidenceId)}`);
    }
  }
  lines.push("");
  if (result.recommendation?.action) {
    lines.push("## 建议");
    lines.push("");
    lines.push(String(result.recommendation.action));
    lines.push("");
  }
  lines.push("Agent 不写公司档案库。正式记录由业务系统确认。");
  return lines.join("\n");
}

export function markdownBlocks(text) {
  return [{ type: "text", text: String(text || "") }];
}

export function presentCallView(title) {
  return { card: "generic", kind: "fetch", title: String(title || "electronics-agent") };
}

export function presentResultView(title, result, fallbackMarkdown) {
  const fromMeta = result?.meta && typeof result.meta === "object" ? result.meta.markdown : "";
  const fromContent = Array.isArray(result?.content)
    ? result.content.map((b) => b.text || "").join("\n")
    : "";
  const text = fromMeta || fromContent || fallbackMarkdown || "";
  return {
    card: "generic",
    title: String(title || ""),
    content: markdownBlocks(text),
  };
}
