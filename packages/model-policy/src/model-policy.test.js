import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MODEL_REGISTRY,
  capabilityMatrix,
  createModelRouter,
  inferRole,
  meetsCapabilities,
  toModelRoute,
} from "./index.js";

const root = dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);

const ALL_KEYS = {
  OPENCODE_GO_API_KEY: "x",
  ZAI_API_KEY: "x",
  XAI_API_KEY: "x",
  ECONOMY_FAST_KEY: "x",
  ECONOMY_STRONG_KEY: "x",
  ECONOMY_LONG_KEY: "x",
};

test("package is Harness-independent and stores no API keys", () => {
  const pkg = req("../package.json");
  assert.equal(pkg.dependencies, undefined);
  const src = ["registry.js", "router.js", "role.js", "health.js", "index.js"]
    .map((f) => readFileSync(join(root, f), "utf8"))
    .join("\n");
  assert.doesNotMatch(src, /from ["']@deepseek-ai/);
  assert.doesNotMatch(src, /sk-[a-zA-Z0-9]{8,}|apiKey\s*[:=]\s*["']/);
});

test("fast/reasoning/vision/long route to the declared production models", () => {
  const router = createModelRouter({ env: ALL_KEYS });
  const fast = router.resolve({ kind: "import", sourceType: "text" });
  assert.equal(fast.ok, true);
  assert.equal(fast.role, "fast");
  assert.equal(fast.model, "deepseek-v4-flash");

  const reasoning = router.resolve({ kind: "part" });
  assert.equal(reasoning.role, "reasoning");
  assert.equal(reasoning.model, "deepseek-v4-pro");

  const vision = router.resolve({ kind: "import", sourceType: "image" });
  assert.equal(vision.role, "vision");
  assert.equal(vision.model, "GLM-4V-flash");

  const long = router.resolve({ kind: "import", sourceType: "pdf" });
  assert.equal(long.role, "long");
  assert.equal(long.model, "kimi-k3");
});

test("capability miss keeps a model out of the candidate list", () => {
  const broken = MODEL_REGISTRY.map((m) =>
    m.model === "deepseek-v4-flash"
      ? { ...m, capabilities: { ...m.capabilities, toolCalling: "fail" } }
      : m,
  );
  const router = createModelRouter({ registry: broken, env: ALL_KEYS });
  const fast = router.resolve({ kind: "import", sourceType: "text" });
  assert.equal(fast.ok, true);
  assert.notEqual(fast.model, "deepseek-v4-flash");
  assert.equal(fast.model, "free-fast");
  assert.equal(meetsCapabilities(broken[0], "fast"), false);
});

test("429/timeout fall back to the next priority model", () => {
  const router = createModelRouter({ env: ALL_KEYS });
  const first = router.resolve({ kind: "part" });
  assert.equal(first.model, "deepseek-v4-pro");
  const second = router.fallback(first, { kind: "part" }, { status: 429 });
  assert.equal(second.ok, true);
  assert.equal(second.model, "qwen3.7-max");
  assert.equal(second.fallbackCount, 1);
  const third = router.fallback(second, { kind: "part" }, { message: "timeout" });
  assert.equal(third.model, "free-strong");
});

test("premium is only selected for escalation or quality policy", () => {
  const router = createModelRouter({ env: ALL_KEYS });
  const normal = router.resolve({ kind: "part" });
  assert.notEqual(normal.model, "grok-4.6");
  const escalated = router.resolve({ kind: "part", lowConfidence: true });
  assert.equal(escalated.role, "premium");
  assert.equal(escalated.model, "grok-4.6");
  assert.equal(escalated.escalated, true);
  const quality = router.resolve({ kind: "part", quality: "quality", role: "premium" });
  assert.equal(quality.model, "grok-4.6");
  const qualityReasoning = router.resolve({ kind: "part", quality: "quality" });
  assert.notEqual(qualityReasoning.model, "grok-4.6");
});

test("inferRole is deterministic and capability matrix lists every registry row", () => {
  assert.equal(inferRole({ kind: "import", sourceType: "csv" }), "fast");
  assert.equal(inferRole({ kind: "import", mime: "image/png" }), "vision");
  assert.equal(inferRole({ kind: "import", filename: "bom.pdf" }), "long");
  assert.equal(inferRole({ kind: "company" }), "reasoning");
  assert.equal(inferRole({ kind: "part", conflictingEvidence: true }), "premium");
  const matrix = capabilityMatrix();
  assert.equal(matrix.length, MODEL_REGISTRY.length);
  assert.ok(matrix.every((row) => row.capabilities.json && row.roles.length));
});

test("toModelRoute never includes credential names", () => {
  const router = createModelRouter({ env: ALL_KEYS });
  const route = toModelRoute(router.resolve({ kind: "import", sourceType: "text" }));
  assert.deepEqual(Object.keys(route).sort(), ["escalated", "fallbackCount", "model", "provider", "quality", "role"]);
  assert.equal("credentialEnv" in route, false);
});
