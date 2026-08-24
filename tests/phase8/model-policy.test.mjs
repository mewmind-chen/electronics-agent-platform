import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createModelRouter } from "../../packages/model-policy/src/index.js";
import { productionFixture } from "../../packages/model-policy/src/fixture.js";
import {
  isAgentAvailable,
  resolveAgentRuntime,
  resolveModelPolicy,
} from "../../apps/agent-api/src/agent-runtime.js";
import { AGENT_UNAVAILABLE, createRuntime } from "../../apps/agent-api/src/runtime.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("unqualified default policy cannot resolve a production model", () => {
  const policy = resolveModelPolicy({ kind: "import", sourceType: "text" }, {}, { router: createModelRouter({ live: [] }) });
  assert.equal(policy.ok, false);
});

test("qualified router hook still returns provider/model without secrets", () => {
  const router = createModelRouter({ registry: productionFixture() });
  const policy = resolveModelPolicy({ kind: "part" }, {}, { router, kind: "part" });
  assert.equal(policy.ok, true);
  assert.equal(policy.model, "deepseek-v4-pro");
  assert.equal(policy.credentialEnv, undefined);
});

test("isAgentAvailable asks the router, not a hardcoded DEEPSEEK_API_KEY", () => {
  const router = createModelRouter({ registry: productionFixture() });
  assert.equal(
    isAgentAvailable({
      env: {},
      processIsReady: true,
      task: { kind: "import", sourceType: "text" },
      router,
    }),
    true,
  );
  assert.equal(
    isAgentAvailable({
      env: { DEEPSEEK_API_KEY: "present" },
      processIsReady: true,
      task: { kind: "import", sourceType: "text" },
      router: createModelRouter({ live: [] }),
    }),
    false,
  );
});

test("resolveAgentRuntime is the router hook", () => {
  const router = createModelRouter({ registry: productionFixture() });
  const resolved = resolveAgentRuntime({
    env: {},
    task: { kind: "part" },
    overrideAvailable: true,
    router,
  });
  assert.equal(resolved.available, true);
  assert.equal(resolved.policy.model, "deepseek-v4-pro");
  assert.equal(resolved.modelRoute.role, "reasoning");
});

test("runtime.js does not decide availability by DEEPSEEK_API_KEY literal", () => {
  const src = readFileSync(join(root, "apps/agent-api/src/runtime.js"), "utf8");
  assert.doesNotMatch(src, /DEEPSEEK_API_KEY/);
  assert.match(src, /isAgentAvailable/);
  assert.match(src, /resolveAgentRuntime/);
});

test("agent mode with no resolvable model fails closed", async () => {
  const runtime = createRuntime({
    env: { ELECTRONICS_HARNESS_STUB: "" },
    harnessAvailable: false,
  });
  const out = await runtime.runPartResearch({ mpn: "NE555P", steps: ["hqew"], mode: "agent" });
  assert.equal(out.ok, false);
  assert.equal(out.error, AGENT_UNAVAILABLE);
  assert.equal(out.route, "unavailable");
  assert.equal(runtime.harnessStarts, 0);
});

test("auto with no resolvable model falls back to core", async () => {
  const runtime = createRuntime({
    env: { ELECTRONICS_HARNESS_STUB: "" },
    harnessAvailable: false,
  });
  const part = await runtime.runPartResearch({ mpn: "NE555P", steps: ["hqew"], mode: "auto" });
  assert.equal(part.ok, true);
  assert.equal(part.route, "core_fallback");
  assert.equal(part.modelRoute, null);
  assert.equal(runtime.harnessStarts, 0);
});

test("core never calls the router or starts Harness", async () => {
  let officialCalls = 0;
  const router = createModelRouter({ registry: productionFixture() });
  const orig = router.resolve.bind(router);
  let resolveHits = 0;
  router.resolve = (task) => {
    resolveHits += 1;
    return orig(task);
  };
  const runtime = createRuntime({
    env: { ELECTRONICS_HARNESS_STUB: "" },
    harnessAvailable: true,
    router,
    officialRunAgent: async () => {
      officialCalls += 1;
      return { ok: true, viaHarness: true };
    },
  });
  const part = await runtime.runPartResearch({ mpn: "NE555P", steps: ["hqew"], mode: "core" });
  assert.equal(part.ok, true);
  assert.equal(part.route, "core");
  assert.equal(part.modelRoute, null);
  assert.equal(officialCalls, 0);
  assert.equal(runtime.harnessStarts, 0);
  assert.equal(runtime.routerCalls, 0);
  assert.equal(resolveHits, 0);
});

test("429 from official runner uses router fallback metadata", async () => {
  const router = createModelRouter({ registry: productionFixture() });
  let calls = 0;
  const runtime = createRuntime({
    env: { ELECTRONICS_HARNESS_STUB: "" },
    harnessAvailable: true,
    router,
    officialRunAgent: async (job) => {
      calls += 1;
      if (calls === 1) {
        const err = new Error("rate limited");
        err.status = 429;
        throw err;
      }
      return { ok: true, viaHarness: true, usedAi: true, mpn: job.input.mpn };
    },
  });
  const out = await runtime.runPartResearch({ mpn: "NE555P", steps: ["hqew"], mode: "agent" });
  assert.equal(out.ok, true);
  assert.equal(out.modelRoute.model, "qwen3.7-max");
  assert.equal(out.modelRoute.fallbackCount, 1);
  assert.equal(runtime.harnessStarts, 2);
});

test("low-confidence part result escalates to premium without caller flag", async () => {
  const router = createModelRouter({ registry: productionFixture() });
  let seen = [];
  const runtime = createRuntime({
    env: { ELECTRONICS_HARNESS_STUB: "" },
    harnessAvailable: true,
    router,
    officialRunAgent: async (job) => {
      seen.push(job.input.role || "default");
      if (!job.input.role || job.input.role === "reasoning") {
        return { ok: true, verdict: { confidence: "low", state: "未知", claims: [] }, evidence: [] };
      }
      return { ok: true, verdict: { confidence: "medium", state: "平稳", claims: [] }, evidence: [] };
    },
  });
  const out = await runtime.runPartResearch({ mpn: "NE555P", steps: ["hqew"], mode: "agent" });
  assert.equal(out.modelRoute.role, "premium");
  assert.equal(out.modelRoute.escalated, true);
  assert.ok(seen.includes("premium"));
});
