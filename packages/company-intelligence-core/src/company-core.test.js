import test from "node:test";
import assert from "node:assert/strict";
import { aggregateProfile, researchCompany } from "./index.js";

test("frequency aggregation is programmatic", () => {
  const rows = [
    { model: "tps54560ddar", brand: "TI" },
    { model: "TPS54560DDAR", brand: "TI" },
    { model: "TPS54560DDAR", brand: "TI" },
    { model: "LM317T", brand: "ST" },
  ];
  const agg = aggregateProfile(rows, []);
  assert.equal(agg.topMpns[0].mpn, "TPS54560DDAR");
  assert.equal(agg.topMpns[0].hits, 3);
  assert.equal(agg.mainBrands[0].brand, "TI");
});

test("researchCompany without keys does not write a DB", async () => {
  const r = await researchCompany({ company: "某某电子", steps: ["gys"] }, {});
  assert.equal(r.ok, true);
  assert.equal(r.company, "某某电子");
  assert.equal(JSON.stringify(r).includes("INSERT"), false);
});
