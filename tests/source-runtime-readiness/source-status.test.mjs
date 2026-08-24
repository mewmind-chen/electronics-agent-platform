import test from "node:test";
import assert from "node:assert/strict";
import { runLookupStep } from "@electronics/market-sources";
import { researchPart } from "@electronics/part-intelligence-core";

test("missing Firecrawl is auth_required, never empty", async () => {
  const result = await runLookupStep({ query: "TPS54560DDAR", step: "hqew" }, {});
  assert.equal(result.status, "AUTH_REQUIRED");
  assert.equal(result.sourceTrace.called, false);
  assert.notEqual(result.status, "EMPTY");
});

test("missing AnySearch is auth_required, never an empty evidence result", async () => {
  const result = await runLookupStep({ query: "TPS54560DDAR", step: "intel", kind: "part" }, {});
  assert.equal(result.status, "AUTH_REQUIRED");
  assert.equal(result.sourceTrace.called, false);
  assert.deepEqual(result.intel.hits, []);
});

test("ICNet missing cookie is auth_required, not public zero", async () => {
  const result = await runLookupStep({ query: "TPS54560DDAR", step: "icnet" }, {});
  assert.equal(result.status, "AUTH_REQUIRED");
  assert.equal(result.sourceTrace.called, false);
  assert.equal(result.sourceTrace.dataCount, 0);
});

test("HQEW parser failure is degraded, not EMPTY with zero offers", async () => {
  const result = await runLookupStep(
    { query: "TPS54560DDAR", step: "hqew" },
    { firecrawlKey: "test-key", scrapeMarkdown: async () => "# authenticated page with changed layout" },
  );
  assert.equal(result.status, "DEGRADED");
  assert.equal(result.sourceTrace.called, true);
  assert.equal(result.sourceTrace.dataCount, 0);
  assert.match(result.sourceTrace.degradationReason, /parser|health/i);
});

test("AnySearch explicit no-match is EMPTY", async () => {
  const result = await runLookupStep(
    { query: "TPS54560DDAR", step: "intel", kind: "part" },
    {
      anysearchKey: "test-key",
      fetch: async () => ({ ok: true, async json() { return { code: 0, data: { results: [] } }; } }),
    },
  );
  assert.equal(result.status, "EMPTY");
  assert.equal(result.sourceTrace.called, true);
  assert.equal(result.sourceTrace.dataCount, 0);
});

test("internalQuoteCount zero is distinct from public market zero", async () => {
  const result = await researchPart(
    { mpn: "TPS54560DDAR", steps: ["hqew"] },
    { firecrawlKey: "test-key", scrapeMarkdown: async () => "# authenticated page with changed layout" },
  );
  assert.equal(result.ok, true);
  assert.equal(result.sourceRuntime.internalQuoteCount, 0);
  assert.match(result.sourceRuntime.internalQuoteCountMeaning, /不表示公开市场无报价/);
  assert.equal(result.sourceRuntime.traces[0].status, "DEGRADED");
  assert.equal(result.supply.offerCount, 0);
  assert.notEqual(result.sourceRuntime.traces[0].status, "EMPTY");
});

test("source trace has no credential material", async () => {
  const result = await runLookupStep(
    { query: "TPS54560DDAR", step: "hqew" },
    { firecrawlKey: "trace-secret", scrapeMarkdown: async () => "暂无匹配" },
  );
  const serialized = JSON.stringify(result.sourceTrace);
  assert.doesNotMatch(serialized, /trace-secret/);
  assert.deepEqual(Object.keys(result.sourceTrace).sort(), [
    "called", "configured", "dataCount", "degradationReason", "latencyMs", "source", "status", "url",
  ]);
});
