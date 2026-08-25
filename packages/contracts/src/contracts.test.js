import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseImportCandidate,
  parseImportRequest,
  parseImportResult,
  parseColumnMapping,
  parsePartResearchRequest,
  parsePartResearchResult,
  parseCompanyResearchRequest,
  parseCompanyResearchResult,
  parseClaim,
  parseVerdict,
  parseTaskCreateRequest,
  parseAgentRequest,
  parseAgentResponse,
  parseBusinessContext,
  validateSkillSop,
  CONTRACT_VERSION,
} from "./index.js";

test("package has no Harness dependency", () => {
  const req = createRequire(import.meta.url);
  const pkg = req("../package.json");
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.peerDependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.match(CONTRACT_VERSION, /^\d+\.\d+\.\d+$/);
});

test("import candidate accepts Radar-shaped row without preview flags", () => {
  const parsed = parseImportCandidate({
    kind: "offer",
    mpn: "TPS54560DDAR",
    mpnRaw: "TPS54560DDAR",
    qty: 10000,
    qtyRaw: "10K",
    dateCode: "2418",
    priceAmount: 1.15,
    priceCurrency: "USD",
    isTp: false,
    channel: "老陈",
    warning: "疑似识别异常，请人工确认",
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.mpn, "TPS54560DDAR");
  assert.equal(parsed.value.warnings.length, 1);
  assert.equal(parsed.value.duplicate, undefined);
  assert.equal(parsed.value.selected, undefined);
});

test("import candidate rejects preview/write flags and SQL semantics", () => {
  const flagged = parseImportCandidate({
    kind: "offer",
    mpn: "LM317T",
    selected: true,
    duplicate: false,
  });
  assert.equal(flagged.ok, false);
  assert.match(flagged.errors.map((e) => e.message).join(" "), /preview\/write/);

  const sql = parseImportCandidate({
    kind: "stock",
    mpn: "LM317T",
    note: "please INSERT into stock_lots",
  });
  assert.equal(sql.ok, false);
  assert.match(sql.errors.map((e) => e.message).join(" "), /write\/SQL/);
});

test("MPN must not be auto-completed or rewritten", () => {
  const rewritten = parseImportCandidate({
    kind: "offer",
    mpnRaw: "STM32F103",
    mpn: "STM32F103C8T6",
  });
  assert.equal(rewritten.ok, false);
  assert.match(rewritten.errors.map((e) => e.message).join(" "), /must not be auto-completed/);

  const nfkc = parseImportCandidate({
    kind: "offer",
    mpnRaw: "  TPS54560DDAR  ",
    mpn: "TPS54560DDAR",
  });
  assert.equal(nfkc.ok, true);
});

test("excel mapping requires an mpn column", () => {
  const bad = parseColumnMapping({
    columns: [{ header: "Available", target: "qty" }],
  });
  assert.equal(bad.ok, false);

  const good = parseColumnMapping({
    columns: [
      { header: "P/N", target: "mpn" },
      { header: "Available", target: "qty" },
    ],
  });
  assert.equal(good.ok, true);
});

test("import request and result", () => {
  const req = parseImportRequest({
    kind: "mixed",
    sourceType: "text",
    text: "老陈那边 TI 54560 还有一批",
  });
  assert.equal(req.ok, true);
  assert.equal(req.value.mode, "auto");
  const agentReq = parseImportRequest({
    kind: "offer",
    sourceType: "text",
    text: "x",
    viaAgent: true,
  });
  assert.equal(agentReq.value.mode, "agent");

  const result = parseImportResult({
    usedAi: true,
    candidates: [{ kind: "offer", mpn: "TPS54560DDAR", qty: 10000 }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.candidates[0].mpn, "TPS54560DDAR");
});

test("import request treats prose and opaque image bytes as data, not SQL instructions", () => {
  const text = parseImportRequest({
    kind: "offer",
    sourceType: "text",
    text: "supplier note contains sql as ordinary text",
    mode: "agent",
  });
  assert.equal(text.ok, true);

  const image = parseImportRequest({
    kind: "offer",
    sourceType: "image",
    mime: "image/png",
    fileBase64: "AAEsqlrandomopaquebytes==",
    mode: "agent",
  });
  assert.equal(image.ok, true);
});

test("part research result requires claim evidence to exist", () => {
  const req = parsePartResearchRequest({ mpn: "TPS54560DDAR" });
  assert.equal(req.ok, true);

  const missing = parsePartResearchResult({
    mpn: "TPS54560DDAR",
    verdict: {
      state: "热门",
      score: 70,
      confidence: "medium",
      claims: [{ text: "授权库存可见", evidenceId: "evi-missing" }],
    },
    evidence: [],
  });
  assert.equal(missing.ok, false);

  const good = parsePartResearchResult({
    mpn: "TPS54560DDAR",
    identity: { mpn: "TPS54560DDAR", brand: "TI", category: "DCDC" },
    offers: [
      {
        sourceKey: "lcsc",
        model: "TPS54560DDAR",
        stock: 13330,
        price: 8.2,
        currency: "CNY",
      },
    ],
    evidence: [
      { id: "evi-1", sourceKey: "lcsc", url: "https://so.szlcsc.com", trust: "high" },
    ],
    verdict: {
      state: "平稳",
      score: 40,
      confidence: "medium",
      claims: [{ text: "立创有现货", evidenceId: "evi-1" }],
    },
    recommendation: { action: "观察", reasoning: "授权库存充足" },
  });
  assert.equal(good.ok, true);
});

test("unknown verdict may have zero claims; non-unknown may not", () => {
  const unknown = parseVerdict({ state: "未知", confidence: "low", claims: [] });
  assert.equal(unknown.ok, true);

  const hot = parseVerdict({ state: "热门", score: 80, confidence: "high", claims: [] });
  assert.equal(hot.ok, false);
});

test("company result needs evidence for branded claims", () => {
  const req = parseCompanyResearchRequest({ company: "某某电子" });
  assert.equal(req.ok, true);

  const bad = parseCompanyResearchResult({
    company: "某某电子",
    profile: {
      companyType: "贸易",
      mainBrands: [{ brand: "TI", evidenceId: "evi-x" }],
    },
    evidence: [],
  });
  assert.equal(bad.ok, false);

  const good = parseCompanyResearchResult({
    company: "某某电子",
    profile: {
      companyType: "贸易",
      mainBrands: [{ brand: "TI", evidenceId: "evi-gys" }],
    },
    companies: [{ name: "某某电子", shopUrl: "https://x.hqew.com", brands: ["TI"] }],
    shopRows: [{ model: "TPS54560DDAR", brand: "TI", stock: 5000 }],
    evidence: [{ id: "evi-gys", sourceKey: "gys", title: "供应商名片" }],
    verdict: {
      state: "画像完成",
      score: 60,
      confidence: "medium",
      claims: [{ text: "主营 TI", evidenceId: "evi-gys" }],
    },
  });
  assert.equal(good.ok, true);
});

test("task create is typed and forbids SQL", () => {
  const part = parseTaskCreateRequest({ type: "part_research", input: { mpn: "NE555P" } });
  assert.equal(part.ok, true);
  const company = parseTaskCreateRequest({
    type: "company_research",
    input: { company: "某某电子" },
  });
  assert.equal(company.ok, true);
  const sql = parseTaskCreateRequest({
    type: "part_research",
    input: { mpn: "NE555P", note: "INSERT into parts" },
  });
  assert.equal(sql.ok, false);
});

test("claim helper", () => {
  const claim = parseClaim({ text: "立创有货", evidenceId: "evi-1" });
  assert.equal(claim.ok, true);
});

test("agent request/response and part skill SOP are frozen", () => {
  const req = parseAgentRequest({ message: "分析 TPS54560DDAR" });
  assert.equal(req.ok, true);
  const skill = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../.dsh/skills/part.md"), "utf8");
  assert.equal(validateSkillSop(skill).ok, true);
  const good = parseAgentResponse({
    ok: true,
    intent: { kind: "part_research", skill: "part", mpn: "TPS54560DDAR" },
    skill: "part",
    toolsCalled: ["part_research"],
    result: {
      mpn: "TPS54560DDAR",
      evidence: [{ id: "evi-1", sourceKey: "lcsc", title: "lcsc" }],
      verdict: { state: "平稳", score: 40, confidence: "medium", claims: [{ text: "交叉完成", evidenceId: "evi-1" }] },
    },
    report: { markdown: "# 型号研究 TPS54560DDAR", claimsCited: ["evi-1"] },
  });
  assert.equal(good.ok, true);
  const missing = parseAgentResponse({
    ok: true,
    intent: { kind: "part_research", skill: "part", mpn: "TPS54560DDAR" },
  });
  assert.equal(missing.ok, false);
});

test("business context keeps internal sources off the evidence list", () => {
  const parsed = parseBusinessContext({
    inventory: { source: "radar", onHand: 8000, inTransit: 0 },
    quotation: { source: "workbench", openCount: 3 },
    customer: { note: "reserved" },
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.inventory.origin, "radar");
  assert.equal(parsed.value.quotation.origin, "workbench");
  assert.equal(parsed.value.customer.reserved, true);
  assert.equal(parsed.value.internalQuoteCount, 3);
  const sql = parseBusinessContext({ inventory: { onHand: 1, note: "INSERT into stock" } });
  assert.equal(sql.ok, false);
});
