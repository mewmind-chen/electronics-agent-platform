import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCompanyResearchRequest, parseCompanyResearchResult } from "../../../packages/contracts/src/index.js";
import { researchCompany } from "../../../packages/company-intelligence-core/src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(join(here, "cases.v1.json"), "utf8"));
const allowedTypes = new Set(["贸易", "代理", "工厂", "unknown"]);

test("company eval corpus v1 has 20+ stable, sanitized cases across required risk shapes", () => {
  assert.equal(corpus.schemaVersion, "1.0");
  assert.ok(corpus.cases.length >= 20);
  const ids = new Set(corpus.cases.map((row) => row.id));
  assert.equal(ids.size, corpus.cases.length);
  for (const bucket of ["trade", "agent", "factory", "ambiguous-name", "empty-evidence", "source-conflict", "wrong-company"]) {
    assert.ok(corpus.cases.some((row) => row.bucket === bucket), `missing bucket ${bucket}`);
  }
  for (const row of corpus.cases) {
    assert.match(row.id, /^company-v1-\d{3}$/);
    assert.equal(parseCompanyResearchRequest(row.input).ok, true, row.id);
    assert.ok(allowedTypes.has(row.expected.companyType), row.id);
    assert.ok(["low", "medium", "high"].includes(row.expected.confidence), row.id);
    assert.equal(row.expected.requireEvidenceForBrands, true, row.id);
    assert.equal(row.expected.requireEvidenceForModels, true, row.id);
    assert.equal(row.expected.requiresHumanReview, true, row.id);
    assert.equal(typeof row.humanLabel, "string", row.id);
    assert.ok(row.humanLabel.length > 8, row.id);
  }
});

test("company contract couples branded claims and verdict claims to listed evidence", () => {
  const withEvidence = parseCompanyResearchResult({
    company: "脱敏样本供应商",
    evidence: [{ id: "evi-gys", sourceKey: "gys", title: "公开供应商页", trust: "medium" }],
    profile: {
      companyType: "贸易",
      mainBrands: [{ brand: "示例品牌", evidenceId: "evi-gys" }],
      topMpns: [{ mpn: "DEMO-ONLY", evidenceId: "evi-gys" }],
    },
    verdict: { state: "画像完成", confidence: "medium", claims: [{ text: "公开页存在", evidenceId: "evi-gys" }] },
  });
  assert.equal(withEvidence.ok, true, JSON.stringify(withEvidence.errors));

  const uncited = parseCompanyResearchResult({
    company: "脱敏样本供应商",
    profile: { mainBrands: [{ brand: "示例品牌", evidenceId: "missing" }], topMpns: [{ mpn: "DEMO-ONLY", evidenceId: "missing" }] },
    verdict: { state: "画像完成", confidence: "medium", claims: [{ text: "未证实", evidenceId: "missing" }] },
    evidence: [],
  });
  assert.equal(uncited.ok, false);
});

test("company core stays unknown and does not invent brands or models with no evidence", async () => {
  const row = corpus.cases.find((item) => item.expected.unknownWithoutEvidence);
  assert.ok(row);
  const result = await researchCompany({ company: row.input.company, steps: [] }, {});
  assert.equal(result.ok, true);
  assert.equal(result.verdict.state, "未知");
  assert.equal(result.verdict.confidence, "low");
  assert.deepEqual(result.verdict.claims, []);
  assert.deepEqual(result.profile.mainBrands, []);
  assert.deepEqual(result.profile.topMpns, []);
  assert.equal(result.profile.identity.companyType, "unknown");
});

test("ambiguous, conflicting, empty and wrong-company labels require a human decision", () => {
  const highRisk = corpus.cases.filter((row) => ["ambiguous-name", "empty-evidence", "source-conflict", "wrong-company"].includes(row.bucket));
  assert.ok(highRisk.length >= 8);
  for (const row of highRisk) {
    assert.equal(row.expected.requiresHumanReview, true, row.id);
    assert.equal(row.expected.confidence, "low", row.id);
    assert.equal(row.expected.companyType, "unknown", row.id);
  }
});
