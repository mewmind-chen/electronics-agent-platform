/**
 * Business smoke acceptors. Used by live qualification and unit tests.
 * No Harness imports. No secrets.
 */
import { parseCompanyResearchResult, parseImportResult, parsePartResearchResult } from "@electronics/contracts";

export const IMPORT_FIXTURE_TEXT = "TPS54560DDAR 10K 2418 $1.15";

export const LONG_BOM_TEXT = [
  "MPN QTY DC PRICE",
  "TPS54560DDAR 10K 2418 $1.15",
  "STM32F103C8T6 5K 2336 $0.82",
  "NRF52840-QIAA 2500 2401 $2.40",
  "W25Q64JVSSIQ 20K 2312 $0.31",
  "LM317T 8000 2218 $0.12",
  "AT24C256C-SSHL-T 1200 2406 $0.28",
  "ESP32-WROOM-32E 3K 2410 $1.05",
  "SN74LVC245APWR 15K 2308 $0.09",
  "AMS1117-3.3 9K 2411 $0.06",
  "USB2514B-AEZC 400 2402 $1.88",
].join("\n");

export function normalizeImportResult(result) {
  if (!result || typeof result !== "object") return { candidates: [] };
  if (Array.isArray(result.candidates)) return result;
  if (Array.isArray(result)) return { candidates: result };
  if (result.value && Array.isArray(result.value.candidates)) return result.value;
  if (Array.isArray(result.rows)) return { candidates: result.rows };
  return { candidates: [] };
}

export function acceptImportRegression(result) {
  const normalized = normalizeImportResult(result);
  const parsed = parseImportResult({
    candidates: normalized.candidates || [],
    mapping: normalized.mapping || result?.mapping,
    usedAi: true,
  });
  if (!parsed.ok) return { ok: false, reason: parsed.errors.map((e) => e.message).join("; ") };
  const row = parsed.value.candidates.find((c) => c.mpn === "TPS54560DDAR");
  if (!row) return { ok: false, reason: "missing TPS54560DDAR candidate" };
  if (row.mpn !== "TPS54560DDAR") return { ok: false, reason: "mpn rewritten" };
  if (row.qty !== 10000) return { ok: false, reason: `qty=${row.qty}` };
  if (String(row.dateCode || "") !== "2418") return { ok: false, reason: `dateCode=${row.dateCode}` };
  if (Number(row.priceAmount) !== 1.15) return { ok: false, reason: `price=${row.priceAmount}` };
  if (row.priceCurrency && row.priceCurrency !== "USD") return { ok: false, reason: `currency=${row.priceCurrency}` };
  if (row.qty === 2418 || row.priceAmount === 2418 || row.dateCode === "10K") {
    return { ok: false, reason: "qty/price/DC fields swapped" };
  }
  return { ok: true, rowCount: parsed.value.candidates.length };
}

export function acceptLongImport(result, expectedMinRows = 8) {
  const normalized = normalizeImportResult(result);
  const parsed = parseImportResult({
    candidates: normalized.candidates || [],
    mapping: normalized.mapping || result?.mapping,
    usedAi: true,
  });
  if (!parsed.ok) return { ok: false, reason: parsed.errors.map((e) => e.message).join("; ") };
  const rows = parsed.value.candidates;
  if (rows.length < expectedMinRows) return { ok: false, reason: `only ${rows.length} rows` };
  const want = ["TPS54560DDAR", "STM32F103C8T6", "NRF52840-QIAA", "ESP32-WROOM-32E"];
  const missing = want.filter((mpn) => !rows.some((r) => r.mpn === mpn));
  if (missing.length) return { ok: false, reason: `missing ${missing.join(",")}` };
  const first = rows.find((r) => r.mpn === "TPS54560DDAR");
  if (!first || first.qty !== 10000) return { ok: false, reason: "key row qty lost" };
  return { ok: true, rowCount: rows.length };
}

export function acceptResearch(result, { kind, expectedKey }) {
  const parsed =
    kind === "company" ? parseCompanyResearchResult(result || {}) : parsePartResearchResult(result || {});
  if (!parsed.ok) return { ok: false, reason: parsed.errors.map((e) => e.message).join("; ") };
  const value = parsed.value;
  if (kind === "part" && expectedKey && value.mpn !== expectedKey) {
    return { ok: false, reason: `mpn truncated or rewritten: ${value.mpn}` };
  }
  if (kind === "company" && expectedKey && value.company !== expectedKey) {
    return { ok: false, reason: `company rewritten: ${value.company}` };
  }
  const evidence = value.evidence || [];
  const ids = new Set(evidence.map((e) => e.id));
  const claims = value.verdict?.claims || [];
  if (claims.some((c) => !ids.has(c.evidenceId))) return { ok: false, reason: "claim missing evidenceId" };
  if (evidence.some((e) => /fail|error/i.test(String(e.title || e.fields?.error || "")))) {
    return { ok: false, reason: "source failure stored as evidence" };
  }
  if (value.verdict?.state && value.verdict.state !== "未知" && !claims.length && !evidence.length) {
    return { ok: false, reason: "conclusion without evidence" };
  }
  return { ok: true };
}

export function emptyBusiness() {
  return { import: "unknown", part: "unknown", company: "unknown" };
}
