/**
 * File readers. Bytes / text in, matrices or normalized text out.
 * No semantic recognition.
 */
import { correctTradeText } from "@electronics/domain";

export function parseCsv(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((line) => line.split(/[,\t]/).map((c) => c.trim().replace(/^"|"$/g, "")));
}

export function extractTextLines(raw) {
  const normalized = correctTradeText(raw ?? "");
  const lines = normalized
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  return { normalized, lines };
}

export async function parseExcelBase64(base64) {
  const XLSX = await import("xlsx");
  const buf = Buffer.from(String(base64 || ""), "base64");
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
  return json.map((row) => (row ?? []).map((c) => String(c ?? "").trim()));
}

/** First header-like row + next 3..10 data rows for the Agent mapping tool. */
export function tablePreview(table, sampleRows = 8) {
  const rows = Array.isArray(table) ? table : [];
  if (!rows.length) return { header: [], sample: [], headerIndex: 0, remainingStart: 0 };
  let headerIndex = 0;
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const joined = rows[i].join(" ").toLowerCase();
    if (/型号|mpn|p\/n|part|料号|pn/.test(joined)) {
      headerIndex = i;
      break;
    }
  }
  const header = rows[headerIndex] ?? [];
  const after = rows.slice(headerIndex + 1).filter((r) => r.some((c) => String(c).trim()));
  return {
    header,
    sample: after.slice(0, Math.max(3, Math.min(10, sampleRows))),
    headerIndex,
    remainingStart: headerIndex + 1,
  };
}

export function classifyInput(input) {
  const sourceType = input.sourceType;
  const name = String(input.filename || "").toLowerCase();
  const mime = String(input.mime || "");
  if (sourceType === "excel" || /\.xlsx?$/.test(name)) return "table";
  if (sourceType === "csv" || name.endsWith(".csv")) return "table";
  if (sourceType === "image" || mime.startsWith("image/")) return "image";
  if (sourceType === "pdf" || sourceType === "word" || mime.includes("pdf") || /\.(pdf|docx?)$/.test(name)) {
    return "document";
  }
  return "text";
}
