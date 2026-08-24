import test from "node:test";
import assert from "node:assert/strict";
import { computeMarketAnalysis, extraKnowledge } from "./knowledge.js";
import { researchPart } from "./research.js";

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
