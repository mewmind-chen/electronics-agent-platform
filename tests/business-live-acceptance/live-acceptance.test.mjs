import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const dir = import.meta.dirname;
const resultsText = readFileSync(join(dir, "results.json"), "utf8");
const results = JSON.parse(resultsText);
const fixtureText = readFileSync(join(dir, "fixtures/kowin-shape.redacted.json"), "utf8");
const fixture = JSON.parse(fixtureText);

test("business-live acceptance evidence is complete and passing", () => {
  assert.equal(results.overall, "pass");
  const scenarios = Object.values(results.matrix).flat();
  assert.ok(scenarios.length >= 10);
  assert.ok(scenarios.every((scenario) => scenario.status === "pass"));
  assert.equal(results.environment.credentialsRecorded, false);
  assert.equal(results.environment.rawBusinessWorkbookCommitted, false);
});

test("real workbook fixture is redacted while preserving the semantic mapping shape", () => {
  assert.equal(fixture.sourceKind, "real-business-xlsx-redacted");
  assert.equal(fixture.headerRow, 2);
  assert.ok(fixture.headers.includes("Quoted p/n"));
  assert.ok(fixture.headers.includes("Lead time, weeks"));
  assert.ok(fixture.sampleRows.length >= 3);
  assert.ok(fixture.redactedFields.includes("quotedPrice"));
  assert.ok(fixture.redactedFields.includes("documentNumber"));
  assert.doesNotMatch(fixtureText, /"(?:documentNumber|targetPrice|quotedPrice)"\s*:\s*(?!null)/);
});

test("evidence contains no bearer credential or environment secret assignment", () => {
  assert.doesNotMatch(resultsText, /Bearer\s+[^\s"']+/i);
  assert.doesNotMatch(resultsText, /(?:API_KEY|TOKEN)\s*[:=]\s*[^\s"']+/i);
  assert.doesNotMatch(fixtureText, /Bearer\s+[^\s"']+/i);
});
