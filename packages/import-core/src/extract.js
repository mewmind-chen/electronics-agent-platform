/**
 * Programmatic extract used by Agent API.
 *
 * Table + explicit mapping → deterministic bulk parse (no LLM).
 * Unstructured text/image without rows → needs the official Harness path.
 * This module never runs heuristicParse as a success path.
 */
import { parseImportRequest, parseImportResult } from "@electronics/contracts";
import { applyMappingToTable } from "./mapping.js";
import { classifyInput, extractTextLines, parseCsv, parseExcelBase64, tablePreview } from "./readers.js";
import { validateExtractedRows } from "./validators.js";

export async function extractImport(input) {
  const req = parseImportRequest(input);
  if (!req.ok) return { ok: false, error: "invalid ImportRequest", errors: req.errors };

  const data = req.value;
  const cls = classifyInput(data);

  if (cls === "table") {
    let table = [];
    if (data.sourceType === "excel") {
      if (!data.fileBase64) return { ok: false, error: "fileBase64 required for excel" };
      table = await parseExcelBase64(data.fileBase64);
    } else {
      const raw = data.text ?? (data.fileBase64 ? Buffer.from(data.fileBase64, "base64").toString("utf8") : "");
      table = parseCsv(raw);
    }
    const preview = tablePreview(table);
    if (input.mapping) {
      const applied = applyMappingToTable(table, input.mapping, {
        defaultKind: data.kind,
        headerIndex: preview.headerIndex,
      });
      const parsed = parseImportResult({
        candidates: applied.candidates,
        mapping: applied.mapping,
        usedAi: false,
      });
      if (!parsed.ok) return { ok: false, error: "invalid ImportResult", errors: parsed.errors };
      return { ok: true, needsAgent: false, ...parsed.value, preview };
    }
    return {
      ok: true,
      needsAgent: true,
      reason: "table_mapping_required",
      preview,
      candidates: [],
      usedAi: false,
    };
  }

  if (Array.isArray(input.rawRows) && input.rawRows.length) {
    const sourceText = data.text ? extractTextLines(data.text).normalized : data.text;
    const validated = validateExtractedRows(input.rawRows, {
      defaultKind: data.kind,
      sourceText,
      provenanceCheck: cls === "text" || cls === "document",
    });
    const parsed = parseImportResult({
      candidates: validated.candidates,
      usedAi: Boolean(input.usedAi),
    });
    if (!parsed.ok) return { ok: false, error: "invalid ImportResult", errors: parsed.errors };
    return { ok: true, needsAgent: false, ...parsed.value };
  }

  return {
    ok: true,
    needsAgent: true,
    reason: cls === "image" ? "vision_required" : "unstructured_required",
    candidates: [],
    usedAi: false,
    textPreview: data.text ? extractTextLines(data.text) : null,
  };
}
