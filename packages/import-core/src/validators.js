/**
 * Deterministic validators. AI output is not a fact source.
 * MPN: NFKC/trim only. Qty/price: local parsers win on conflict → warning.
 */
import { displayMpn, parseImportCandidate } from "@electronics/contracts";
import { brandShort, parseCost, parseQty, resolveWarehouseCode } from "@electronics/domain";

export function verifyMpnProvenance(mpn, sourceText) {
  if (!sourceText) return null;
  const hay = String(sourceText).normalize("NFKC").toLowerCase();
  const needle = displayMpn(mpn).toLowerCase();
  if (!needle) return "缺少型号";
  return hay.includes(needle) ? null : "疑似识别异常，请人工确认";
}

export function qtyFromRawOrNumber(qty, qtyRaw) {
  if (qtyRaw != null && String(qtyRaw).trim()) {
    const parsed = parseQty(String(qtyRaw));
    if (parsed != null) return { qty: parsed, from: "parser", raw: String(qtyRaw) };
  }
  if (typeof qty === "number" && Number.isFinite(qty)) {
    return { qty: Math.round(qty), from: "model", raw: String(qty) };
  }
  return { qty: null, from: "none", raw: qtyRaw != null ? String(qtyRaw) : null };
}

function explicitSourceFacts(sourceText) {
  const text = String(sourceText || "").normalize("NFKC");
  return {
    dateCode: /(?:\b(?:dc|date\s*code)\s*[:：#-]?\s*[a-z]?\d{2,4}\+?|(?:批次|年周)\s*[:：#-]?\s*[a-z]?\d{2,4}\+?)/iu.test(text),
    leadTime: /(?:交期|货期|lead\s*time|\blt\b|\baot\b)\s*[:：#-]?\s*\d+(?:\.\d+)?\s*(?:周|星期|天|日|weeks?|wks?|days?)?/iu.test(text),
  };
}

/**
 * Turn a raw extraction row into a validated ImportCandidate.
 * Conflicts become warnings; values are never silently trusted.
 */
export function validateExtractedRow(raw, opts = {}) {
  const defaultKind = opts.defaultKind && opts.defaultKind !== "mixed" ? opts.defaultKind : "offer";
  const mpn = displayMpn(raw.mpn ?? raw.mpnRaw ?? "");
  const qtyInfo = qtyFromRawOrNumber(raw.qty, raw.qtyRaw ?? (typeof raw.qty === "string" ? raw.qty : null));
  const warnings = [];

  if (opts.provenanceCheck !== false) {
    const w = verifyMpnProvenance(mpn, opts.sourceText);
    if (w) warnings.push({ code: "mpn_provenance", message: w, field: "mpn" });
  }

  if (raw.qty != null && qtyInfo.from === "parser") {
    const modelQty = typeof raw.qty === "number" ? Math.round(raw.qty) : parseQty(String(raw.qty));
    if (modelQty != null && qtyInfo.qty != null && modelQty !== qtyInfo.qty) {
      warnings.push({
        code: "qty_conflict",
        message: `qty conflict: model=${modelQty} parser(${qtyInfo.raw})=${qtyInfo.qty}`,
        field: "qty",
      });
    }
  }

  const priceSource = raw.priceAmount ?? raw.price ?? raw.costAmount ?? raw.cost ?? "";
  const parsedCost = parseCost(
    typeof priceSource === "number" ? String(priceSource) : String(priceSource || ""),
  );

  const candidate = {
    kind: raw.kind && raw.kind !== "mixed" ? raw.kind : defaultKind,
    mpn,
    mpnRaw: raw.mpnRaw != null ? String(raw.mpnRaw) : mpn,
    brand: raw.brand ? brandShort(raw.brand) : null,
    qty: qtyInfo.qty,
    qtyRaw: qtyInfo.raw,
    dateCode: raw.dateCode ? String(raw.dateCode) : null,
    priceAmount: raw.priceAmount != null && Number.isFinite(Number(raw.priceAmount))
      ? Number(raw.priceAmount)
      : parsedCost.amount,
    priceCurrency: raw.priceCurrency ?? parsedCost.currency,
    priceTax: raw.priceTax ?? parsedCost.tax,
    isTp: Boolean(raw.isTp) || parsedCost.isTp,
    leadTimeText: raw.leadTimeText ? String(raw.leadTimeText) : null,
    etaText: raw.etaText ? String(raw.etaText) : raw.leadTimeText ? String(raw.leadTimeText) : null,
    warehouse: resolveWarehouseCode(raw.warehouse ?? null),
    channel: raw.channel ? String(raw.channel) : null,
    customer: raw.customer ? String(raw.customer) : null,
    package: raw.package ? String(raw.package) : null,
    standardPack: raw.standardPack ? String(raw.standardPack) : null,
    packState: raw.packState ?? null,
    costAmount: raw.costAmount != null && Number.isFinite(Number(raw.costAmount))
      ? Number(raw.costAmount)
      : parsedCost.amount,
    costCurrency: raw.costCurrency ?? parsedCost.currency,
    costTax: raw.costTax ?? parsedCost.tax,
    note: raw.note ? String(raw.note) : null,
    warnings,
  };

  const explicit = explicitSourceFacts(opts.sourceText);
  if (!candidate.dateCode && explicit.dateCode) {
    warnings.push({
      code: "date_code_missing",
      message: "原文含明确批次/DC，但当前候选未提取；请人工核对归属。",
      field: "dateCode",
    });
  }
  if (!candidate.leadTimeText && explicit.leadTime) {
    warnings.push({
      code: "lead_time_missing",
      message: "原文含明确交期，但当前候选未提取；请人工核对是否为统一交期。",
      field: "leadTimeText",
    });
  }

  return parseImportCandidate(candidate);
}

export function validateExtractedRows(raws, opts = {}) {
  const candidates = [];
  const errors = [];
  for (const [i, raw] of (raws ?? []).entries()) {
    const parsed = validateExtractedRow(raw, opts);
    if (!parsed.ok) errors.push(...parsed.errors.map((e) => ({ ...e, path: `rows[${i}].${e.path}` })));
    else candidates.push(parsed.value);
  }
  return { ok: errors.length === 0, candidates, errors };
}
