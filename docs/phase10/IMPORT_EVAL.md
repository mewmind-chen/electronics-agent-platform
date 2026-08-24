# Import Eval Corpus v1

`tests/phase10/import-eval/cases.v1.json` is the versioned, sanitized release gate for Import extraction. It has 30 synthetic cases distilled from Radar's public test/fixture shapes: mapped offer, stock, inquiry and transit tables; chat-like rows; quantity, price, date-code and warehouse normalization; quantity conflict; suspicious MPN provenance; and image/document capability states.

Each entry has a stable `imp-v1-###` identifier, `sourceType`, read-only `input`, deterministic `expected` constraints, `requiresHumanReview`, and a Chinese reviewer label. It intentionally contains no customer identity, credential, contact, real inventory position, lot detail, or channel identity.

Run it directly:

```bash
node --test tests/phase10/import-eval/eval.test.mjs
```

The eval verifies that deterministic candidates preserve MPN except NFKC/trim normalization, have no business-app write flags, and satisfy available quantity/price/date-code/warehouse constraints. It also verifies that high-uncertainty inputs remain explicit capability states (`vision_required`, `unstructured_required`, `table_mapping_required`, or `fileBase64_required`) with no invented candidate.

This corpus evaluates Platform contracts and deterministic extraction only. It does not authorize writes, decide Radar event type, deduplicate, attach customers, or convert a candidate into inventory/quotation facts; those decisions remain in Radar and with the operator.
