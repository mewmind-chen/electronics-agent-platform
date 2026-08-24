/**
 * Excel / CSV bulk executor.
 * The Agent decides column mapping once; this module applies it to every row.
 * There is no headerKey() regex main path here.
 */
import { parseColumnMapping } from "@electronics/contracts";
import { validateExtractedRow } from "./validators.js";

export function applyMappingToTable(table, mappingInput, opts = {}) {
  const mapping = parseColumnMapping(mappingInput);
  if (!mapping.ok) return { ok: false, candidates: [], errors: mapping.errors, mapping: null };

  const rows = Array.isArray(table) ? table : [];
  const headerIndex = opts.headerIndex ?? 0;
  const header = rows[headerIndex] ?? [];
  const targetByHeader = new Map(
    mapping.value.columns.map((c) => [String(c.header).normalize("NFKC").trim().toLowerCase(), c.target]),
  );
  const indexByTarget = {};
  header.forEach((h, i) => {
    const target = targetByHeader.get(String(h).normalize("NFKC").trim().toLowerCase());
    if (target && indexByTarget[target] == null) indexByTarget[target] = i;
  });

  if (indexByTarget.mpn == null) {
    return {
      ok: false,
      candidates: [],
      errors: [{ path: "mapping", message: "mapped mpn column not found in header row" }],
      mapping: mapping.value,
    };
  }

  const get = (line, target) => {
    const i = indexByTarget[target];
    return i == null ? "" : String(line[i] ?? "").trim();
  };

  const candidates = [];
  const errors = [];
  for (const [offset, line] of rows.slice(headerIndex + 1).entries()) {
    if (!line.some((c) => String(c ?? "").trim())) continue;
    const raw = {
      kind: opts.defaultKind && opts.defaultKind !== "mixed" ? opts.defaultKind : undefined,
      mpn: get(line, "mpn"),
      brand: get(line, "brand"),
      qtyRaw: get(line, "qty"),
      dateCode: get(line, "dateCode"),
      price: get(line, "price") || get(line, "cost"),
      leadTimeText: get(line, "lt"),
      warehouse: get(line, "warehouse"),
      customer: get(line, "customer"),
      channel: get(line, "channel"),
      package: get(line, "package"),
      note: line.filter(Boolean).join(" | "),
    };
    if (raw.customer && (!opts.defaultKind || opts.defaultKind === "mixed")) raw.kind = "inquiry";
    else if (raw.warehouse && (!opts.defaultKind || opts.defaultKind === "mixed")) raw.kind = "stock";
    else if (!raw.kind) raw.kind = "offer";

    const parsed = validateExtractedRow(raw, { ...opts, provenanceCheck: false });
    if (!parsed.ok) {
      errors.push(...parsed.errors.map((e) => ({ ...e, path: `row[${offset}].${e.path}` })));
      continue;
    }
    if (!parsed.value.mpn) continue;
    candidates.push(parsed.value);
  }

  return { ok: errors.length === 0, candidates, errors, mapping: mapping.value };
}
