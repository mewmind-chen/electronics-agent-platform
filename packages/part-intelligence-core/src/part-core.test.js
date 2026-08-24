import test from "node:test";
import assert from "node:assert/strict";
import { computeMarketAnalysis, extraKnowledge } from "./knowledge.js";
import { researchPart } from "./research.js";
import { composePartReport } from "./compose.js";
import { inferPartIntent } from "./intent.js";
import { createContextAdviser, defaultAdviser, adviseFromContext } from "./context.js";

test("STM32 series knowledge is domain core, not a plugin", () => {
  assert.equal(extraKnowledge("STM32F103C8T6").family.includes("STM32F1"), true);
});

test("hotness weights inquiry over supplier count", () => {
  const fewSuppliers = computeMarketAnalysis({
    mpn: "X",
    internalQuoteCount: 6,
    currentOffers: Array.from({ length: 3 }, () => ({ sourceKey: "hqew", price: 1 })),
  });
  const manySuppliers = computeMarketAnalysis({
    mpn: "X",
    internalQuoteCount: 0,
    currentOffers: Array.from({ length: 40 }, () => ({ sourceKey: "hqew", price: 1 })),
  });
  assert.ok(fewSuppliers.hotness.score > manySuppliers.hotness.score);
});

test("researchPart without keys still returns a contract result and does not write SQL", async () => {
  const r = await researchPart({ mpn: "NE555P", steps: ["hqew"] }, {});
  assert.equal(r.ok, true);
  assert.equal(r.mpn, "NE555P");
  assert.equal(r.verdict.state, "未知");
  assert.equal(JSON.stringify(r).includes("INSERT"), false);
});

test("inferPartIntent copies TPS54560DDAR from a Chinese sentence", () => {
  const intent = inferPartIntent("分析 TPS54560DDAR");
  assert.equal(intent.kind, "part_research");
  assert.equal(intent.mpn, "TPS54560DDAR");
});

test("composer only cites existing claims and keeps MPN", () => {
  const report = composePartReport({
    mpn: "TPS54560DDAR",
    evidence: [{ id: "evi-1", sourceKey: "lcsc", title: "lcsc" }],
    verdict: {
      state: "平稳",
      score: 40,
      confidence: "medium",
      claims: [{ text: "已交叉市场行", evidenceId: "evi-1" }],
    },
    recommendation: { action: "人工确认后报价", reasoning: "稳压器" },
  });
  assert.match(report.markdown, /TPS54560DDAR/);
  assert.deepEqual(report.claimsCited, ["evi-1"]);
  assert.match(report.markdown, /evi-1/);
  assert.match(report.markdown, /# 型号分析报告/);
  assert.match(report.markdown, /## 综合建议/);
});

test("context adviser seam keeps default rules and accepts custom rules", () => {
  const biz = { inventory: { origin: "radar", onHand: 8000 }, quotation: { origin: "workbench", openCount: 4 } };
  const base = adviseFromContext(biz, "平稳");
  assert.equal(base.usedInternal, true);
  assert.match(base.action, /消化库存/);

  const custom = createContextAdviser();
  custom.register((b, _state) => ({
    action: "custom-decision",
    internalView: "custom",
    combined: "custom advice",
    usedInternal: true,
  }));
  const out = adviseFromContext(biz, "平稳", custom);
  assert.equal(out.action, "custom-decision");

  // an empty custom adviser has no rules → generic fallback, not the default
  const empty = adviseFromContext({}, "未知", createContextAdviser());
  assert.equal(empty.usedInternal, false);
  assert.match(empty.action, /人工确认/);
  assert.notEqual(empty.action, "补公开数据后再判断是否开发");
});

test("composer accepts a thin unknown harness payload", () => {
  const report = composePartReport({ mpn: "TPS54560DDAR", verdict: { state: "未知" }, evidence: [] });
  assert.match(report.markdown, /TPS54560DDAR/);
  assert.match(report.markdown, /证据不足/);
  assert.deepEqual(report.claimsCited, []);
});
