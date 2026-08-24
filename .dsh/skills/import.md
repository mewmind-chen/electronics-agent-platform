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
| `import_validate_mapping` | validate a mapping when Platform already supplied a bounded preview |
| `import_apply_mapping` | after you decide `{header → target}` |
| `import_normalize_text` | chat / unstructured text cleanup |
| `import_validate_rows` | after you extract raw rows from unstructured text or a picture |

## Table (Excel / CSV)

When the request already contains `preview`:

1. Look at `preview.header` and `preview.sample`. Map once, for example `P/N → mpn`, `Available → qty`.
2. Call `import_validate_mapping` with the exact preview header and `{columns:[{header,target}]}`.
3. Return that tool JSON unchanged. The Platform keeps the original bytes and deterministically applies the accepted mapping to every row.
4. Never request, repeat, or relay file bytes through the model context.

For a direct Harness session without a supplied preview, use `import_table_preview`, then `import_apply_mapping`.
Do **not** write a regex header matcher or call a homemade heuristic parser.

## Unstructured text

1. `import_normalize_text`.
2. You extract raw rows (MPN copied verbatim). Keep quantity, date code, price, and lead time separate. Apply explicit shared/unified facts, such as one common lead time, to every affected row.
3. `import_validate_rows` with `sourceText` so qty/price/MPN are checked.
4. Keep every validator warning, including `qty_conflict`, `mpn_provenance`, `date_code_missing`, and `lead_time_missing`. Do not silently rewrite or hide a source fact that was not captured.

## Image

The user message includes the picture as an image block. Read that attached image, extract raw rows (MPN copied verbatim), then `import_validate_rows`. Do not guess from the filename. Keep quantity, date code, and price in separate fields. Copy MPN characters exactly.

## Hard rules

1. MPN: copy only. NFKC/trim is allowed. No autocomplete.
2. Quantity `10K` is 10000. Trust `import_validate_rows`, not mental math.
3. Never return `selected`, `duplicate`, or `confirmImport`.
4. Never INSERT / write Radar or Workbench databases.
