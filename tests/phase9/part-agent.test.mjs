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

test("official part research receives request-scoped business context only after public research", async () => {
  const router = createModelRouter({
    registry: productionFixture(["opencode-go/deepseek-v4-pro"]),
  });
  const publicEvidence = [{ id: "evi-live", sourceKey: "lcsc", title: "lcsc" }];
  const publicVerdict = {
    state: "平稳",
    score: 40,
    confidence: "medium",
    claims: [{ text: "已交叉市场行", evidenceId: "evi-live" }],
  };
  const runtime = createRuntime({
    env: { ELECTRONICS_HARNESS_STUB: "" },
    harnessAvailable: true,
    router,
    officialRunAgent: async () => ({
      ok: true,
      mpn: "TPS54560DDAR",
      evidence: publicEvidence,
      verdict: publicVerdict,
      recommendation: { action: "人工确认后报价", reasoning: "public-only" },
      toolsCalled: ["part_research"],
    }),
  });
  const input = {
    message: "分析 TPS54560DDAR",
    mode: "agent",
    context: {
      inventory: { source: "radar", onHand: 8000, inTransit: 0 },
      quotation: { source: "workbench", openCount: 4 },
    },
  };

  const direct = await runtime.runPartResearch({ ...input, mpn: "TPS54560DDAR" });
  assert.equal(direct.advice.usedInternal, true);
  assert.equal(direct.businessContext.inventory.origin, "radar");
  assert.equal(direct.businessContext.quotation.origin, "workbench");
  assert.match(direct.recommendation.action, /消化库存|询价/);
  assert.deepEqual(direct.evidence, publicEvidence);
  assert.deepEqual(direct.verdict, publicVerdict);
  assert.equal(JSON.stringify(direct.evidence).includes("radar"), false);
  assert.equal(JSON.stringify(direct.evidence).includes("workbench"), false);

  const chat = await runtime.runChat(input);
  assert.equal(chat.result.advice.usedInternal, true);
  assert.match(chat.report.markdown, /库存上下文（radar）/);
  assert.match(chat.report.markdown, /询价上下文（workbench）/);
  assert.equal(JSON.stringify(chat.result.evidence).includes("radar"), false);
  assert.equal(JSON.stringify(chat.result.evidence).includes("workbench"), false);
  assert.deepEqual(publicEvidence, [{ id: "evi-live", sourceKey: "lcsc", title: "lcsc" }]);
  assert.deepEqual(publicVerdict, {
    state: "平稳",
    score: 40,
    confidence: "medium",
    claims: [{ text: "已交叉市场行", evidenceId: "evi-live" }],
  });
});

test("escalated official part research also receives post-processed business context", async () => {
  const router = createModelRouter({
    registry: productionFixture(["opencode-go/deepseek-v4-pro", "subscriptions/grok-4.6"]),
  });
  let calls = 0;
  const runtime = createRuntime({
    env: { ELECTRONICS_HARNESS_STUB: "" },
    harnessAvailable: true,
    router,
    officialRunAgent: async () => {
      calls += 1;
      return {
        ok: true,
        mpn: "TPS54560DDAR",
        evidence: [{ id: `evi-${calls}`, sourceKey: "lcsc", title: "lcsc" }],
        verdict: {
          state: "平稳",
          score: 40,
          confidence: calls === 1 ? "low" : "medium",
          claims: [{ text: "公开市场判断", evidenceId: `evi-${calls}` }],
        },
        recommendation: { action: "人工确认后报价", reasoning: "public-only" },
        toolsCalled: ["part_research"],
      };
    },
  });
  const result = await runtime.runPartResearch({
    mpn: "TPS54560DDAR",
    mode: "agent",
    context: {
      inventory: { source: "radar", onHand: 8000 },
      quotation: { source: "workbench", openCount: 4 },
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.modelRoute.escalated, true);
  assert.equal(result.advice.usedInternal, true);
  assert.equal(result.businessContext.inventory.origin, "radar");
  assert.equal(result.businessContext.quotation.origin, "workbench");
  assert.equal(result.evidence[0].id, "evi-2");
  assert.equal(JSON.stringify(result.evidence).includes("radar"), false);
  assert.equal(JSON.stringify(result.verdict).includes("workbench"), false);
});

test("chat does not invent an unsupported company as part research", async () => {
  const runtime = createRuntime({ env: { ELECTRONICS_HARNESS_STUB: "" }, harnessAvailable: false });
  const out = await runtime.runChat({ message: "帮我看看华强北天气", mode: "agent" });
  assert.equal(out.ok, false);
  assert.equal(out.error, "unsupported_intent");
  assert.equal(runtime.harnessStarts, 0);
});
