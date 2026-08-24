import test from "node:test";
import assert from "node:assert/strict";
import { parseExecutionMode } from "../../packages/contracts/src/index.js";
import { AGENT_UNAVAILABLE, createRuntime } from "../../apps/agent-api/src/runtime.js";

function envNoHarness() {
  return { DEEPSEEK_API_KEY: "", ELECTRONICS_HARNESS_STUB: "" };
}

test("viaAgent maps to mode; default is auto", () => {
  assert.equal(parseExecutionMode({}, "x", []), "auto");
  assert.equal(parseExecutionMode({ viaAgent: true }, "x", []), "agent");
  assert.equal(parseExecutionMode({ viaAgent: false }, "x", []), "core");
  assert.equal(parseExecutionMode({ mode: "core", viaAgent: true }, "x", []), "core");
});

test("production default never uses stub or labels viaHarness/usedAi", async () => {
  const runtime = createRuntime({ env: envNoHarness(), harnessAvailable: false });
  assert.equal(runtime.stubAllowed, false);
  const unstructured = await runtime.runImport({
    kind: "offer",
    sourceType: "text",
    text: "老陈那边 TI TPS54560DDAR 还有一批 大概10K",
  });
  assert.equal(unstructured.viaHarness, false);
  assert.equal(unstructured.usedAi, false);
  assert.notEqual(unstructured.route, "stub");
  assert.equal(unstructured.mode, "auto");
  assert.equal(unstructured.fallbackFrom, "agent_unavailable");
  assert.equal(runtime.harnessStarts, 0);
});

test("auto falls back to core when official Harness is unavailable", async () => {
  const runtime = createRuntime({ env: envNoHarness(), harnessAvailable: false });
  const part = await runtime.runPartResearch({ mpn: "NE555P", steps: ["hqew"], mode: "auto" });
  assert.equal(part.ok, true);
  assert.equal(part.route, "core_fallback");
  assert.equal(part.viaHarness, false);
  assert.equal(part.usedAi, false);
  assert.equal(part.fallbackFrom, "agent_unavailable");
  assert.equal(runtime.harnessStarts, 0);
});

test("agent refuses stub and core when Harness is unavailable", async () => {
  let officialCalls = 0;
  const runtime = createRuntime({
    env: envNoHarness(),
    harnessAvailable: false,
    officialRunAgent: async () => {
      officialCalls += 1;
      throw new Error("should not start");
    },
  });
  const out = await runtime.runPartResearch({ mpn: "NE555P", steps: ["hqew"], mode: "agent" });
  assert.equal(out.ok, false);
  assert.equal(out.error, AGENT_UNAVAILABLE);
  assert.equal(out.viaHarness, false);
  assert.equal(out.usedAi, false);
  assert.equal(out.route, "unavailable");
  assert.equal(officialCalls, 0);
  assert.equal(runtime.harnessStarts, 0);
});

test("agent never silently uses the test stub", async () => {
  const runtime = createRuntime({
    env: { DEEPSEEK_API_KEY: "", ELECTRONICS_HARNESS_STUB: "1" },
    allowStub: false,
    harnessAvailable: false,
  });
  const out = await runtime.runImport({
    kind: "offer",
    sourceType: "text",
    text: "TPS54560DDAR 10K",
    mode: "agent",
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, AGENT_UNAVAILABLE);
  assert.notEqual(out.route, "stub");
  assert.equal(out.viaHarness, false);
});

test("core never starts Harness even when a runner is injected", async () => {
  let officialCalls = 0;
  const runtime = createRuntime({
    env: { DEEPSEEK_API_KEY: "sk-test", ELECTRONICS_HARNESS_STUB: "" },
    harnessAvailable: true,
    officialRunAgent: async () => {
      officialCalls += 1;
      return { ok: true, viaHarness: true, usedAi: true, candidates: [{ mpn: "FAKE" }] };
    },
  });
  const mapped = await runtime.runImport({
    kind: "offer",
    sourceType: "csv",
    text: "P/N,Available\nTPS54560DDAR,10K\n",
    mapping: { columns: [{ header: "P/N", target: "mpn" }, { header: "Available", target: "qty" }] },
    mode: "core",
  });
  assert.equal(mapped.ok, true);
  assert.equal(mapped.route, "core");
  assert.equal(mapped.viaHarness, false);
  assert.equal(mapped.usedAi, false);
  assert.equal(mapped.candidates[0].mpn, "TPS54560DDAR");

  const part = await runtime.runPartResearch({ mpn: "NE555P", steps: ["hqew"], mode: "core" });
  assert.equal(part.ok, true);
  assert.equal(part.route, "core");
  assert.equal(officialCalls, 0);
  assert.equal(runtime.harnessStarts, 0);
});

test("auto uses official runner when Harness is available", async () => {
  const runtime = createRuntime({
    env: { DEEPSEEK_API_KEY: "sk-test", ELECTRONICS_HARNESS_STUB: "" },
    harnessAvailable: true,
    officialRunAgent: async (job) => {
      assert.equal(job.kind, "import");
      return {
        ok: true,
        candidates: [{ kind: "offer", mpn: "TPS54560DDAR", qty: 10000 }],
        usedAi: true,
        viaHarness: true,
        toolsCalled: ["import_validate_rows"],
      };
    },
  });
  const out = await runtime.runImport({
    kind: "offer",
    sourceType: "text",
    text: "TPS54560DDAR 10K",
    mode: "auto",
  });
  assert.equal(out.ok, true);
  assert.equal(out.viaHarness, true);
  assert.equal(out.usedAi, true);
  assert.equal(out.route, "harness");
  assert.equal(runtime.harnessStarts, 1);
});
