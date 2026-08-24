import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseImportRequest } from "../../../packages/contracts/src/index.js";
import { extractImport } from "../../../packages/import-core/src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(here, "cases.v1.json"), "utf8"));

function candidateFor(result, id) {
  assert.equal(result.ok, true, `${id}: ${JSON.stringify(result.errors || result)}`);
  assert.equal(result.needsAgent, false, `${id}: expected deterministic candidate`);
  assert.equal(result.candidates.length, 1, `${id}: expected exactly one sanitized candidate`);
  return result.candidates[0];
}

test("import eval corpus v1 is versioned, sanitized, and broad enough for release gating", () => {
  assert.equal(cases.length, 30);
  assert.equal(new Set(cases.map((row) => row.id)).size, cases.length);
  assert.ok(cases.every((row) => /^imp-v1-\d{3}$/.test(row.id)));
  assert.ok(cases.every((row) => row.sourceType === row.input.sourceType));
  assert.ok(cases.every((row) => row.humanLabel && row.expected));

  const sources = new Set(cases.map((row) => row.sourceType));
  for (const source of ["csv", "excel", "text", "image", "pdf", "word"]) assert.ok(sources.has(source));
  assert.ok(cases.filter((row) => row.expected.mode === "mapped_table").length >= 8);
  assert.ok(cases.filter((row) => row.expected.mode === "validated_rows").length >= 8);
  assert.ok(cases.filter((row) => row.expected.mode === "capability").length >= 8);
  assert.ok(cases.filter((row) => row.expected.requiresHumanReview).length >= 10);

  const corpus = JSON.stringify(cases);
  assert.doesNotMatch(corpus, /(?:sk-|api[_-]?key|password|token)\s*[:=]/i);
  assert.doesNotMatch(corpus, /瀚博微|真实客户|手机号|@/i);
  assert.doesNotMatch(corpus, /\b(?:库存|onHand)\s*[:：]\s*[1-9]\d{4,}/i);
});

test("every corpus input is read-only ImportRequest; write semantics are rejected", () => {
  for (const row of cases) {
    const parsed = parseImportRequest(row.input);
    assert.equal(parsed.ok, true, `${row.id}: ${JSON.stringify(parsed.errors)}`);
    assert.equal(row.input.confirmImport, undefined, `${row.id}: corpus must not encode writes`);
    assert.equal(row.input.writeDb, undefined, `${row.id}: corpus must not encode writes`);
  }
  const forbidden = parseImportRequest({
    kind: "offer", sourceType: "text", text: "TPS54560DDAR 1K", confirmImport: true,
  });
  assert.equal(forbidden.ok, false);
});

test("the evaluated extraction path has no database dependency or write operation", () => {
  const extractSource = readFileSync(join(here, "../../../packages/import-core/src/extract.js"), "utf8");
  assert.doesNotMatch(extractSource, /(?:database|sql|insert|update|delete|confirmImport)/i);
});

test("mapped tables and validated chat candidates meet deterministic constraints without write flags", async () => {
  for (const row of cases) {
    if (row.expected.mode === "mapped_table" && row.sourceType !== "excel") {
      const candidate = candidateFor(await extractImport(row.input), row.id);
      assert.equal(candidate.mpn, row.expected.mpn, row.id);
      if (row.expected.qty != null) assert.equal(candidate.qty, row.expected.qty, row.id);
      if (row.expected.priceAmount != null) assert.equal(candidate.priceAmount, row.expected.priceAmount, row.id);
      if (row.expected.dateCode != null) assert.equal(candidate.dateCode, row.expected.dateCode, row.id);
      if (row.expected.warehouse != null) assert.equal(candidate.warehouse, row.expected.warehouse, row.id);
      assert.equal(candidate.selected, undefined, row.id);
      assert.equal(candidate.duplicate, undefined, row.id);
      assert.equal(candidate.confirmImport, undefined, row.id);
    }
    if (row.expected.mode === "validated_rows") {
      const candidate = candidateFor(await extractImport(row.input), row.id);
      assert.equal(candidate.mpn, row.expected.mpn, row.id);
      if (row.expected.qty != null) assert.equal(candidate.qty, row.expected.qty, row.id);
      if (row.expected.priceAmount != null) assert.equal(candidate.priceAmount, row.expected.priceAmount, row.id);
      if (row.expected.dateCode != null) assert.equal(candidate.dateCode, row.expected.dateCode, row.id);
      if (row.expected.warehouse != null) assert.equal(candidate.warehouse, row.expected.warehouse, row.id);
      if (row.expected.warningCode) assert.ok(candidate.warnings.some((warning) => warning.code === row.expected.warningCode), row.id);
    }
  }
});

test("uncertain images, long documents, and unmapped inputs state capability/review needs instead of inventing rows", async () => {
  for (const row of cases.filter((item) => item.expected.mode === "capability")) {
    const result = await extractImport(row.input);
    assert.equal(row.expected.requiresHumanReview, true, row.id);
    if (row.expected.capabilityState === "fileBase64_required") {
      assert.equal(result.ok, false, row.id);
      assert.match(result.error, /fileBase64 required/i, row.id);
      continue;
    }
    assert.equal(result.ok, true, `${row.id}: ${JSON.stringify(result)}`);
    assert.equal(result.needsAgent, true, row.id);
    assert.equal(result.candidates.length, 0, row.id);
    assert.equal(result.reason, row.expected.capabilityState, row.id);
  }
});
