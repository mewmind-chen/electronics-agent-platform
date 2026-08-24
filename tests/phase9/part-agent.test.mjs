import test from "node:test";
import assert from "node:assert/strict";
import { parseAgentResponse } from "../../packages/contracts/src/index.js";
import { createRuntime } from "../../apps/agent-api/src/runtime.js";
import { createModelRouter } from "../../packages/model-policy/src/index.js";
import { productionFixture } from "../../packages/model-policy/src/fixture.js";

test("chat mode=core is not an Agent loop", async () => {
  const runtime = createRuntime({
    env: { ELECTRONICS_HARNESS_STUB: "" },
    harnessAvailable: true,
    officialRunAgent: async () => {
      throw new Error("official runner must not start in core mode");
    },
  });
  const out = await runtime.runChat({ message: "分析 TPS54560DDAR", mode: "core", steps: ["hqew"] });
  assert.equal(out.viaHarness, false);
  assert.equal(out.route, "core");
  assert.equal(out.intent.mpn, "TPS54560DDAR");
  assert.equal(runtime.harnessStarts, 0);
});

test("chat mode=agent walks official part_research then composer", async () => {
  const router = createModelRouter({
    registry: productionFixture(["opencode-go/deepseek-v4-pro"]),
  });
  const runtime = createRuntime({
    env: { ELECTRONICS_HARNESS_STUB: "" },
    harnessAvailable: true,
    router,
    officialRunAgent: async (job) => {
      assert.equal(job.kind, "part");
      assert.equal(job.input.mpn, "TPS54560DDAR");
      assert.match(String(job.input.message || ""), /分析 TPS54560DDAR/);
      return {
        ok: true,
        mpn: "TPS54560DDAR",
        evidence: [{ id: "evi-live", sourceKey: "lcsc", title: "lcsc" }],
        verdict: {
          state: "平稳",
          score: 40,
          confidence: "medium",
          claims: [{ text: "已交叉市场行", evidenceId: "evi-live" }],
        },
        recommendation: { action: "人工确认后报价", reasoning: "ok" },
        toolsCalled: ["part_research"],
      };
    },
  });
  const out = await runtime.runChat({ message: "分析 TPS54560DDAR", mode: "agent" });
  const parsed = parseAgentResponse(out);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors || out));
  assert.equal(out.viaHarness, true);
  assert.equal(out.skill, "part");
  assert.ok(out.toolsCalled.includes("part_research"));
  assert.equal(out.result.mpn, "TPS54560DDAR");
  assert.match(out.report.markdown, /TPS54560DDAR/);
  assert.deepEqual(out.report.claimsCited, ["evi-live"]);
  assert.equal(runtime.harnessStarts, 1);
});

test("chat does not invent an unsupported company as part research", async () => {
  const runtime = createRuntime({ env: { ELECTRONICS_HARNESS_STUB: "" }, harnessAvailable: false });
  const out = await runtime.runChat({ message: "帮我看看华强北天气", mode: "agent" });
  assert.equal(out.ok, false);
  assert.equal(out.error, "unsupported_intent");
  assert.equal(runtime.harnessStarts, 0);
});
