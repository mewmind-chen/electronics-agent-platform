---
name: import
description: Electronics import intelligence. Use when converting Excel/CSV/PDF/image/chat text into ImportCandidate rows. Never write a business database.
user-invocable: true
---

# Import Intelligence SOP

Return `ImportCandidate[]` only. Do not confirm import. Do not invent SQL.

## Tools

| Tool | When |
|---|---|
| `import_classify` | first, to see table vs text vs image |
| `import_table_preview` | Excel/CSV: read header + 3–10 sample rows |
| `import_apply_mapping` | after you decide `{header → target}` |
| `import_normalize_text` | chat / unstructured text cleanup |
| `import_validate_rows` | after you extract raw rows from unstructured text or a picture |

## Table (Excel / CSV)

1. `import_table_preview`.
2. Look at the header and sample. Map once, for example `P/N → mpn`, `Available → qty`.
3. `import_apply_mapping` with that mapping. The program parses every remaining row.
4. Do **not** write a regex header matcher. Do **not** call a homemade heuristic parser.

## Unstructured text

1. `import_normalize_text`.
2. You extract raw rows (MPN copied verbatim).
3. `import_validate_rows` with `sourceText` so qty/price/MPN are checked.
4. If the validator reports `qty_conflict` or `mpn_provenance`, keep the warning. Do not silently rewrite.

## Image

Use the runtime vision path, then `import_validate_rows`. Copy MPN characters exactly.

## Hard rules

1. MPN: copy only. NFKC/trim is allowed. No autocomplete.
2. Quantity `10K` is 10000. Trust `import_validate_rows`, not mental math.
3. Never return `selected`, `duplicate`, or `confirmImport`.
4. Never INSERT / write Radar or Workbench databases.
