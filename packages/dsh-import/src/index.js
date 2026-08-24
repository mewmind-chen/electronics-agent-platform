/**
 * electronics-import — official DeepSeek Harness plugin (Phase 3).
 * Tools only. Orchestration belongs to the official agent loop + Import Skill.
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import { parseColumnMapping, parseImportRequest } from "@electronics/contracts";
import {
  applyMappingToTable,
  classifyInput,
  extractTextLines,
  parseCsv,
  parseExcelBase64,
  tablePreview,
  validateMappingForHeader,
  validateExtractedRows,
} from "@electronics/import-core";

export const name = "electronics-import";
export const inject = ["tools"];

function jsonResult(value) {
  return JSON.parse(JSON.stringify(value));
}

export function apply(ctx) {
  process.stderr.write("[electronics-import] plugin loaded\n");

  ctx.tools.register(
    defineTool({
      name: "import_classify",
      description:
        "Classify an import payload as table / text / document / image. Does not parse semantics.",
      parameters: {
        sourceType: { type: "string", required: true, description: "excel|csv|pdf|word|image|text" },
        filename: { type: "string", description: "optional filename" },
        mime: { type: "string", description: "optional mime" },
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render(_args, value) {
          return [{ type: "text", text: JSON.stringify(value) }];
        },
      },
      async execute(args) {
        return jsonResult({ class: classifyInput(args) });
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "import_table_preview",
      description:
        "Read Excel/CSV into a header + 3-10 sample rows so you can decide column mapping. Do not invent MPN.",
      parameters: {
        sourceType: { type: "string", required: true },
        fileBase64: { type: "string", description: "xlsx/csv base64" },
        text: { type: "string", description: "csv/text body" },
        filename: { type: "string" },
        mime: { type: "string" },
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render(_args, value) {
          return [{ type: "text", text: JSON.stringify(value) }];
        },
      },
      async execute(args) {
        let table = [];
        if (args.sourceType === "excel" || String(args.filename || "").match(/\.xlsx?$/i)) {
          if (!args.fileBase64) return { ok: false, error: "fileBase64 required for excel" };
          table = await parseExcelBase64(args.fileBase64);
        } else {
          const raw = args.text ?? (args.fileBase64 ? Buffer.from(args.fileBase64, "base64").toString("utf8") : "");
          table = parseCsv(raw);
        }
        const preview = tablePreview(table);
        return jsonResult({ ok: true, ...preview, rowCount: table.length });
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "import_validate_mapping",
      description:
        "Validate one semantic column mapping against the Platform-supplied table header. Receives no file bytes and never parses business rows.",
      parameters: {
        header: { type: "array", required: true, items: { type: "string" } },
        mapping: {
          type: "object",
          additionalProperties: true,
          required: true,
          description: "{ columns: [{ header, target }] } targets: mpn,qty,brand,dateCode,price,lt,...",
        },
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render(_args, value) {
          return [{ type: "text", text: JSON.stringify(value) }];
        },
      },
      async execute(args) {
        return jsonResult(validateMappingForHeader(args.header, args.mapping));
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "import_apply_mapping",
      description:
        "Apply a column mapping to every table row with deterministic parsers. You choose mapping once; this tool bulk-parses.",
      parameters: {
        sourceType: { type: "string", required: true },
        mapping: {
          type: "object",
          additionalProperties: true,
          required: true,
          description: "{ columns: [{ header, target }] } targets: mpn,qty,brand,...",
        },
        defaultKind: { type: "string", description: "offer|inquiry|stock|transit|mixed" },
        fileBase64: { type: "string" },
        text: { type: "string" },
        filename: { type: "string" },
        headerIndex: { type: "number" },
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render(_args, value) {
          return [{ type: "text", text: JSON.stringify(value) }];
        },
      },
      async execute(args) {
        const mapped = parseColumnMapping(args.mapping);
        if (!mapped.ok) return { ok: false, errors: mapped.errors };
        let table = [];
        if (args.sourceType === "excel" || String(args.filename || "").match(/\.xlsx?$/i)) {
          if (!args.fileBase64) return { ok: false, error: "fileBase64 required" };
          table = await parseExcelBase64(args.fileBase64);
        } else {
          const raw = args.text ?? (args.fileBase64 ? Buffer.from(args.fileBase64, "base64").toString("utf8") : "");
          table = parseCsv(raw);
        }
        const applied = applyMappingToTable(table, mapped.value, {
          defaultKind: args.defaultKind,
          headerIndex: args.headerIndex,
        });
        return jsonResult({
          ok: applied.ok,
          candidates: applied.candidates,
          errors: applied.errors,
          mapping: applied.mapping,
        });
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "import_validate_rows",
      description:
        "Validate raw extracted rows (from unstructured text/image). MPN is never rewritten. Qty/price conflicts become warnings.",
      parameters: {
        defaultKind: { type: "string", description: "offer|inquiry|stock|transit|mixed" },
        sourceText: { type: "string", description: "original text for MPN provenance" },
        rows: {
          type: "array",
          required: true,
          items: { type: "object", additionalProperties: true },
        },
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render(_args, value) {
          return [{ type: "text", text: JSON.stringify(value) }];
        },
      },
      async execute(args) {
        const result = validateExtractedRows(args.rows, {
          defaultKind: args.defaultKind,
          sourceText: args.sourceText,
          provenanceCheck: Boolean(args.sourceText),
        });
        return jsonResult(result);
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "import_normalize_text",
      description: "Normalize chat/trade text (仓名/AOT→LT). Never changes MPN characters.",
      parameters: {
        text: { type: "string", required: true },
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render(_args, value) {
          return [{ type: "text", text: JSON.stringify(value) }];
        },
      },
      async execute(args) {
        return jsonResult(extractTextLines(args.text));
      },
    }),
  );

  // Keep parseImportRequest available so the plugin can fail loud on bad envelopes.
  ctx.tools.register(
    defineTool({
      name: "import_parse_request",
      description: "Validate an ImportRequest envelope. Does not extract rows.",
      parameters: {
        request: { type: "object", additionalProperties: true, required: true },
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render(_args, value) {
          return [{ type: "text", text: JSON.stringify(value) }];
        },
      },
      async execute(args) {
        return jsonResult(parseImportRequest(args.request));
      },
    }),
  );
}
