import test from "node:test";
import assert from "node:assert/strict";
import { applyMappingToTable } from "./mapping.js";
import { extractImport } from "./extract.js";
import { validateExtractedRow } from "./validators.js";
import { parseQty } from "@electronics/domain";

test("10K is 10000 and model qty 1000 becomes a warning", () => {
  assert.equal(parseQty("10K"), 10000);
  const row = validateExtractedRow(
    {
      kind: "offer",
      mpn: "TPS7A4700RGWR",
      qty: 1000,
      qtyRaw: "10K",
      priceAmount: 1.15,
      priceCurrency: "USD",
    },
    { sourceText: "TPS7A4700RGWR 10K 2418 $1.15 现货" },
  );
  assert.equal(row.ok, true);
  assert.equal(row.value.qty, 10000);
  assert.ok(row.value.warnings.some((w) => w.code === "qty_conflict"));
});

test("MPN is not rewritten; missing provenance is a warning", () => {
  const row = validateExtractedRow(
    { kind: "offer", mpn: "STM32F103C8T6", qtyRaw: "5K" },
    { sourceText: "老陈那边还有一批 大概10K" },
  );
  assert.equal(row.ok, true);
  assert.equal(row.value.mpn, "STM32F103C8T6");
  assert.ok(row.value.warnings.some((w) => w.code === "mpn_provenance"));
});

test("Excel mapping bulk-parses after Agent mapping, not headerKey regex", () => {
  const table = [
    ["P/N", "Available", "USD", "Mfr"],
    ["TPS54560DDAR", "10K", "1.15", "TI"],
    ["LM317T", "5000", "0.2", "ST"],
  ];
  const applied = applyMappingToTable(table, {
    columns: [
      { header: "P/N", target: "mpn" },
      { header: "Available", target: "qty" },
      { header: "USD", target: "price" },
      { header: "Mfr", target: "brand" },
    ],
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.candidates.length, 2);
  assert.equal(applied.candidates[0].mpn, "TPS54560DDAR");
  assert.equal(applied.candidates[0].qty, 10000);
  assert.equal(applied.candidates[1].qty, 5000);
});

test("unstructured text without rawRows does not silently heuristic-succeed", async () => {
  const out = await extractImport({
    kind: "offer",
    sourceType: "text",
    text: "老陈那边 TI 54560 还有一批 大概10K 24+ 香港现货 一块一美金左右",
  });
  assert.equal(out.ok, true);
  assert.equal(out.needsAgent, true);
  assert.equal(out.reason, "unstructured_required");
  assert.deepEqual(out.candidates, []);
});

test("table without mapping asks the Agent; with mapping returns candidates", async () => {
  const csv = "P/N,Available\nNRF52840-QIAA,8K\n";
  const pending = await extractImport({ kind: "offer", sourceType: "csv", text: csv });
  assert.equal(pending.needsAgent, true);
  assert.equal(pending.reason, "table_mapping_required");

  const done = await extractImport({
    kind: "offer",
    sourceType: "csv",
    text: csv,
    mapping: {
      columns: [
        { header: "P/N", target: "mpn" },
        { header: "Available", target: "qty" },
      ],
    },
  });
  assert.equal(done.needsAgent, false);
  assert.equal(done.candidates[0].mpn, "NRF52840-QIAA");
  assert.equal(done.candidates[0].qty, 8000);
});

test("import-core package is not a Harness runtime", async () => {
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  const pkg = req("../package.json");
  assert.equal(pkg.dependencies["@deepseek-ai/dsh-tools"], undefined);
});
