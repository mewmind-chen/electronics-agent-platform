/**
 * import.ts — ImportRequest / ImportCandidate / Mapping / Warning
 *
 * Field set comes from Radar ImportRow, minus business preview flags
 * (duplicate / selected). Those stay in xinghao-radar.
 *
 * Agent returns candidates only. confirmImport stays in Radar.
 */
import {
  COST_TAXES,
  CURRENCIES,
  assertMpnUnchanged,
  bad,
  displayMpn,
  expectEnum,
  expectNullOrNumber,
  expectNullOrString,
  expectString,
  fail,
  isPlainObject,
  ok,
  parseExecutionMode,
  parseModelSelection,
  rejectWriteSemantics,
} from "./common.js";

export const IMPORT_KINDS = Object.freeze(["offer", "inquiry", "stock", "transit"]);
export const IMPORT_SOURCES = Object.freeze(["excel", "csv", "pdf", "word", "image", "text"]);
export const PACK_STATES = Object.freeze(["full", "loose", "mixed"]);
export const COLUMN_TARGETS = Object.freeze([
  "mpn",
  "brand",
  "qty",
  "dateCode",
  "price",
  "lt",
  "warehouse",
  "customer",
  "channel",
  "package",
  "cost",
]);

export function parseImportRequest(input, path = "importRequest") {
  const errors = [];
  if (!isPlainObject(input)) {
    fail(errors, path, "expected object");
    return bad(errors);
  }
  rejectWriteSemantics(errors, path, input);
  const kind = input.kind === "mixed" ? "mixed" : input.kind;
  if (kind !== "mixed") expectEnum(errors, `${path}.kind`, kind, IMPORT_KINDS);
  expectEnum(errors, `${path}.sourceType`, input.sourceType, IMPORT_SOURCES);
  if (input.text != null) expectString(errors, `${path}.text`, input.text, { allowEmpty: true, max: 200_000 });
  if (input.filename != null) expectString(errors, `${path}.filename`, input.filename, { allowEmpty: true, max: 260 });
  if (input.fileBase64 != null) expectString(errors, `${path}.fileBase64`, input.fileBase64, { allowEmpty: true, max: 8_000_000 });
  if (input.mime != null) expectString(errors, `${path}.mime`, input.mime, { allowEmpty: true, max: 120 });
  const mode = parseExecutionMode(input, path, errors);
  const model = parseModelSelection(input, path, errors);
  if (errors.length) return bad(errors);
  return ok({
    kind,
    sourceType: input.sourceType,
    text: input.text ?? undefined,
    filename: input.filename ?? undefined,
    fileBase64: input.fileBase64 ?? undefined,
    mime: input.mime ?? undefined,
    mode,
    ...model,
  });
}

export function parseColumnMapping(input, path = "mapping") {
  const errors = [];
  if (!isPlainObject(input)) {
    fail(errors, path, "expected object");
    return bad(errors);
  }
  rejectWriteSemantics(errors, path, input);
  if (!Array.isArray(input.columns)) {
    fail(errors, `${path}.columns`, "expected array");
    return bad(errors);
  }
  const columns = [];
  input.columns.forEach((col, i) => {
    if (!isPlainObject(col)) {
      fail(errors, `${path}.columns[${i}]`, "expected object");
      return;
    }
    expectString(errors, `${path}.columns[${i}].header`, col.header, { max: 80 });
    expectEnum(errors, `${path}.columns[${i}].target`, col.target, COLUMN_TARGETS);
    columns.push({ header: String(col.header).trim(), target: col.target });
  });
  const hasMpn = columns.some((c) => c.target === "mpn");
  if (!hasMpn) fail(errors, `${path}.columns`, "mapping must include mpn");
  if (errors.length) return bad(errors);
  return ok({ columns });
}

export function parseImportWarning(input, path = "warning") {
  const errors = [];
  if (typeof input === "string") {
    expectString(errors, path, input, { max: 400 });
    if (errors.length) return bad(errors);
    return ok({ code: "note", message: input.trim() });
  }
  if (!isPlainObject(input)) {
    fail(errors, path, "expected string or object");
    return bad(errors);
  }
  expectString(errors, `${path}.code`, input.code ?? "note", { max: 40 });
  expectString(errors, `${path}.message`, input.message, { max: 400 });
  if (errors.length) return bad(errors);
  return ok({
    code: String(input.code ?? "note"),
    message: String(input.message).trim(),
    field: input.field ? String(input.field) : undefined,
  });
}

export function parseImportCandidate(input, path = "candidate") {
  const errors = [];
  if (!isPlainObject(input)) {
    fail(errors, path, "expected object");
    return bad(errors);
  }
  rejectWriteSemantics(errors, path, input);
  if ("duplicate" in input || "selected" in input || "confirmImport" in input) {
    fail(errors, path, "preview/write flags belong to the business app, not ImportCandidate");
  }
  expectEnum(errors, `${path}.kind`, input.kind, IMPORT_KINDS);
  const original = input.mpnRaw ?? input.mpn;
  expectString(errors, `${path}.mpn`, original, { max: 80 });
  if (input.mpnRaw != null) {
    assertMpnUnchanged(errors, `${path}.mpn`, input.mpnRaw, input.mpn);
  } else {
    const shown = displayMpn(input.mpn);
    if (shown !== String(input.mpn ?? "").normalize("NFKC").trim()) {
      fail(errors, `${path}.mpn`, "mpn must not be rewritten beyond NFKC/trim");
    }
  }
  expectNullOrString(errors, `${path}.brand`, input.brand, { max: 80 });
  expectNullOrNumber(errors, `${path}.qty`, input.qty);
  expectNullOrString(errors, `${path}.qtyRaw`, input.qtyRaw, { max: 40 });
  expectNullOrString(errors, `${path}.dateCode`, input.dateCode, { max: 20 });
  expectNullOrNumber(errors, `${path}.priceAmount`, input.priceAmount);
  if (input.priceCurrency != null) expectEnum(errors, `${path}.priceCurrency`, input.priceCurrency, CURRENCIES);
  if (input.priceTax != null) expectEnum(errors, `${path}.priceTax`, input.priceTax, COST_TAXES);
  if (input.isTp != null && typeof input.isTp !== "boolean") fail(errors, `${path}.isTp`, "expected boolean");
  expectNullOrString(errors, `${path}.leadTimeText`, input.leadTimeText, { max: 80 });
  expectNullOrString(errors, `${path}.etaText`, input.etaText, { max: 80 });
  expectNullOrString(errors, `${path}.warehouse`, input.warehouse, { max: 40 });
  expectNullOrString(errors, `${path}.channel`, input.channel, { max: 80 });
  expectNullOrString(errors, `${path}.customer`, input.customer, { max: 80 });
  expectNullOrString(errors, `${path}.package`, input.package, { max: 40 });
  expectNullOrString(errors, `${path}.standardPack`, input.standardPack, { max: 40 });
  if (input.packState != null) expectEnum(errors, `${path}.packState`, input.packState, PACK_STATES);
  expectNullOrNumber(errors, `${path}.costAmount`, input.costAmount);
  if (input.costCurrency != null) expectEnum(errors, `${path}.costCurrency`, input.costCurrency, CURRENCIES);
  if (input.costTax != null) expectEnum(errors, `${path}.costTax`, input.costTax, COST_TAXES);
  expectNullOrString(errors, `${path}.note`, input.note, { max: 400 });
  const warnings = [];
  if (input.warnings != null) {
    if (!Array.isArray(input.warnings)) fail(errors, `${path}.warnings`, "expected array");
    else {
      input.warnings.forEach((w, i) => {
        const parsed = parseImportWarning(w, `${path}.warnings[${i}]`);
        if (!parsed.ok) errors.push(...parsed.errors);
        else warnings.push(parsed.value);
      });
    }
  } else if (input.warning) {
    const parsed = parseImportWarning(input.warning, `${path}.warning`);
    if (!parsed.ok) errors.push(...parsed.errors);
    else warnings.push(parsed.value);
  }
  if (errors.length) return bad(errors);
  return ok({
    kind: input.kind,
    mpn: displayMpn(input.mpn),
    mpnRaw: input.mpnRaw != null ? String(input.mpnRaw) : displayMpn(input.mpn),
    brand: input.brand ?? null,
    qty: input.qty ?? null,
    qtyRaw: input.qtyRaw ?? null,
    dateCode: input.dateCode ?? null,
    priceAmount: input.priceAmount ?? null,
    priceCurrency: input.priceCurrency ?? null,
    priceTax: input.priceTax ?? null,
    isTp: Boolean(input.isTp),
    leadTimeText: input.leadTimeText ?? null,
    etaText: input.etaText ?? null,
    warehouse: input.warehouse ?? null,
    channel: input.channel ?? null,
    customer: input.customer ?? null,
    package: input.package ?? null,
    standardPack: input.standardPack ?? null,
    packState: input.packState ?? null,
    costAmount: input.costAmount ?? null,
    costCurrency: input.costCurrency ?? null,
    costTax: input.costTax ?? null,
    note: input.note ?? null,
    warnings,
  });
}

export function parseImportResult(input, path = "importResult") {
  const errors = [];
  if (!isPlainObject(input)) {
    fail(errors, path, "expected object");
    return bad(errors);
  }
  rejectWriteSemantics(errors, path, input);
  if (!Array.isArray(input.candidates)) {
    fail(errors, `${path}.candidates`, "expected array");
    return bad(errors);
  }
  const candidates = [];
  input.candidates.forEach((row, i) => {
    const parsed = parseImportCandidate(row, `${path}.candidates[${i}]`);
    if (!parsed.ok) errors.push(...parsed.errors);
    else candidates.push(parsed.value);
  });
  let mapping = null;
  if (input.mapping != null) {
    const parsed = parseColumnMapping(input.mapping, `${path}.mapping`);
    if (!parsed.ok) errors.push(...parsed.errors);
    else mapping = parsed.value;
  }
  if (errors.length) return bad(errors);
  return ok({
    candidates,
    mapping,
    usedAi: Boolean(input.usedAi),
  });
}
