import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MODEL_CANDIDATES,
  MODEL_REGISTRY,
  capabilityMatrix,
  createModelRouter,
  inferRole,
  importNeedsReasoning,
  inProductionPool,
  meetsCapabilities,
  nextEscalationRole,
  providerBindings,
  researchNeedsPremium,
  toModelRoute,
} from "./index.js";
import { productionFixture } from "./fixture.js";

const root = dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);

test("package is Harness-independent and stores no API keys", () => {
  const pkg = req("../package.json");
  assert.deepEqual(Object.keys(pkg.dependencies || {}), ["@electronics/contracts"]);
  const src = ["registry.js", "router.js", "role.js", "health.js", "binding.js", "escalate.js", "index.js"]
    .map((f) => readFileSync(join(root, f), "utf8"))
    .join("\n");
  assert.doesNotMatch(src, /from ["']@deepseek-ai/);
  assert.doesNotMatch(src, /sk-[a-zA-Z0-9]{8,}|apiKey\s*[:=]\s*["']/);
  assert.doesNotMatch(src, /XAI_API_KEY|ECONOMY_FAST_KEY|ZAI_API_KEY/);
});

test("import acceptor enforces TPS54560DDAR regression", async () => {
  const { acceptImportRegression, acceptLongImport, acceptResearch, LONG_BOM_TEXT } = await import("./accept.js");
  const good = acceptImportRegression({
    candidates: [{ kind: "offer", mpn: "TPS54560DDAR", qty: 10000, dateCode: "2418", priceAmount: 1.15, priceCurrency: "USD" }],
  });
  assert.equal(good.ok, true);
  const swapped = acceptImportRegression({
    candidates: [{ kind: "offer", mpn: "TPS54560DDAR", qty: 2418, dateCode: "10K", priceAmount: 10000 }],
  });
  assert.equal(swapped.ok, false);
  const longOk = acceptLongImport({
    candidates: LONG_BOM_TEXT.split("\n")
      .slice(1)
      .map((line) => {
        const [mpn, qty] = line.split(" ");
        return { kind: "offer", mpn, qty: qty === "10K" ? 10000 : 1, dateCode: "2418", priceAmount: 1.15, priceCurrency: "USD" };
      }),
  });
  assert.equal(longOk.ok, true);
  const badClaim = acceptResearch(
    { mpn: "TPS54560DDAR", evidence: [], verdict: { state: "热门", score: 80, confidence: "high", claims: [{ text: "x", evidenceId: "missing" }] }, recommendation: { action: "x", reasoning: "y" } },
    { kind: "part", expectedKey: "TPS54560DDAR" },
  );
  assert.equal(badClaim.ok, false);
});

test("unverified candidates are not production and have unknown capabilities", () => {
  assert.equal(MODEL_REGISTRY, MODEL_CANDIDATES);
  assert.ok(MODEL_CANDIDATES.every((m) => m.pool === "candidate" && m.verified === false));
  assert.ok(MODEL_CANDIDATES.every((m) => m.capabilities.json === "unknown"));
  assert.ok(MODEL_CANDIDATES.every((m) => !inProductionPool(m)));
});

test("fast/reasoning/vision/long route only after qualification", () => {
  const router = createModelRouter({ registry: productionFixture() });
  assert.equal(router.resolve({ kind: "import", sourceType: "text" }).model, "deepseek-v4-flash");
  assert.equal(router.resolve({ kind: "part" }).model, "deepseek-v4-pro");
  assert.equal(router.resolve({ kind: "import", sourceType: "image" }).model, "glm-4v-flash");
  assert.equal(router.resolve({ kind: "import", sourceType: "pdf" }).model, "kimi-k3");
});

test("unqualified default registry cannot be auto-selected", () => {
  const router = createModelRouter({ live: [] });
  const fast = router.resolve({ kind: "import", sourceType: "text" });
  assert.equal(fast.ok, false);
  assert.equal(fast.error, "agent_unavailable");
});

test("capability miss keeps a model out of the candidate list", () => {
  const fixture = productionFixture().map((m) =>
    m.model === "deepseek-v4-flash"
      ? { ...m, capabilities: { ...m.capabilities, toolCalling: "fail" }, verified: false, pool: "candidate" }
      : m,
  );
  const router = createModelRouter({ registry: fixture });
  const fast = router.resolve({ kind: "import", sourceType: "text" });
  assert.equal(fast.ok, true);
  assert.equal(fast.model, "free-fast");
  assert.equal(meetsCapabilities(fixture.find((m) => m.model === "deepseek-v4-flash"), "fast"), false);
});

test("429/timeout fall back to the next priority model", () => {
  const router = createModelRouter({ registry: productionFixture() });
  const first = router.resolve({ kind: "part" });
  assert.equal(first.model, "deepseek-v4-pro");
  const second = router.fallback(first, { kind: "part" }, { status: 429 });
  assert.equal(second.model, "qwen3.7-max");
  const third = router.fallback(second, { kind: "part" }, { message: "timeout" });
  assert.equal(third.model, "free-strong");
});

test("premium is only selected for escalation", () => {
  const router = createModelRouter({ registry: productionFixture() });
  assert.notEqual(router.resolve({ kind: "part" }).model, "grok-4.6");
  const escalated = router.resolve({ kind: "part", lowConfidence: true });
  assert.equal(escalated.model, "grok-4.6");
  assert.equal(escalated.escalated, true);
});

test("result-driven escalation does not require caller lowConfidence", () => {
  assert.equal(researchNeedsPremium({ ok: true, verdict: { confidence: "medium" }, evidence: [] }), false);
  assert.equal(researchNeedsPremium({ ok: true, verdict: { confidence: "low" }, evidence: [] }), true);
  assert.equal(
    nextEscalationRole("part", { ok: true, verdict: { confidence: "low" }, evidence: [] }, "reasoning"),
    "premium",
  );
  assert.equal(
    importNeedsReasoning({
      candidates: [{ warnings: [{ code: "qty_conflict" }] }],
    }),
    true,
  );
  assert.equal(nextEscalationRole("import", { candidates: [{ warnings: [{ code: "qty_conflict" }] }] }, "fast"), "reasoning");
  assert.equal(nextEscalationRole("import", { candidates: [{ warnings: [{ code: "qty_conflict" }] }] }, "fast") === "premium", false);
});

test("bindings expose Harness identities without secrets", () => {
  const rows = providerBindings();
  assert.ok(rows.find((b) => b.id === "subscriptions/grok-4.6" && b.providerId === "grok" && b.auth === "oauth-subscription"));
  assert.ok(rows.find((b) => b.id === "litellm/free-fast" && b.providerId === "llm"));
  assert.ok(rows.find((b) => b.id === "opencode-go/deepseek-v4-flash" && b.providerId === "opencode-go"));
  assert.ok(rows.every((b) => !("apiKey" in b) && !("credentialEnv" in b)));
});

test("inferRole and capability matrix still cover the first batch", () => {
  assert.equal(inferRole({ kind: "import", sourceType: "csv" }), "fast");
  assert.equal(inferRole({ kind: "import", mime: "image/png" }), "vision");
  assert.equal(inferRole({ kind: "import", filename: "bom.pdf" }), "long");
  assert.equal(inferRole({ kind: "company" }), "reasoning");
  const matrix = capabilityMatrix();
  assert.equal(matrix.length, MODEL_CANDIDATES.length);
});

test("toModelRoute never includes credential names", () => {
  const router = createModelRouter({ registry: productionFixture() });
  const route = toModelRoute(router.resolve({ kind: "import", sourceType: "text" }));
  assert.equal("credentialEnv" in route, false);
  assert.equal(route.model, "deepseek-v4-flash");
});
