import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createModelRouter } from "../../packages/model-policy/src/index.js";
import {
  isAgentAvailable,
  resolveAgentRuntime,
  resolveModelPolicy,
} from "../../apps/agent-api/src/agent-runtime.js";
import { AGENT_UNAVAILABLE, createRuntime } from "../../apps/agent-api/src/runtime.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const KEYS = {
  OPENCODE_GO_API_KEY: "x",
  ZAI_API_KEY: "x",
  XAI_API_KEY: "x",
  ECONOMY_FAST_KEY: "x",
  ECONOMY_STRONG_KEY: "x",
  ECONOMY_LONG_KEY: "x",
};

test("execution mode stays independent of model policy", () => {
  const policy = resolveModelPolicy({ kind: "import", sourceType: "text" }, KEYS);
  assert.equal(policy.ok, true);
  assert.equal(policy.model, "deepseek-v4-flash");
  const runtime = createRuntime({
    env: { ELECTRONICS_HARNESS_STUB: "", ...KEYS },
    harnessAvailable: false,
    modelPolicy: { provider: "future-router", model: "x-1", credentialEnv: "OTHER_KEY" },
  });
  assert.equal(runtime.modelPolicy.provider, "future-router");
  assert.equal(runtime.modelPolicy.model, "x-1");
});

test("isAgentAvailable asks the router, not a hardcoded DEEPSEEK_API_KEY", () => {
  assert.equal(
    isAgentAvailable({
      env: KEYS,
      processIsReady: true,
      task: { kind: "import", sourceType: "text" },
    }),
    true,
  );
  assert.equal(
    isAgentAvailable({
      env: { DEEPSEEK_API_KEY: "present" },
      processIsReady: true,
      task: { kind: "import", sourceType: "text" },
    }),
    false,
  );
});

test("resolveAgentRuntime is the router hook", () => {
  const resolved = resolveAgentRuntime({
    env: KEYS,
    task: { kind: "part" },
    overrideAvailable: true,
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
  const router = createModelRouter({ env: KEYS });
  const orig = router.resolve.bind(router);
  let resolveHits = 0;
  router.resolve = (task) => {
    resolveHits += 1;
    return orig(task);
  };
  const runtime = createRuntime({
    env: { ELECTRONICS_HARNESS_STUB: "", ...KEYS },
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
  const router = createModelRouter({ env: KEYS });
  let calls = 0;
  const runtime = createRuntime({
    env: { ELECTRONICS_HARNESS_STUB: "", ...KEYS },
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
