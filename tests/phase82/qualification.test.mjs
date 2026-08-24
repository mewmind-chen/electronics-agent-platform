import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MODEL_CANDIDATES,
  applyQualification,
  createModelRouter,
  inProductionPool,
  loadLiveResults,
  nextEscalationRole,
  providerBindings,
} from "../../packages/model-policy/src/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("live results never contain secrets", () => {
  const raw = readFileSync(join(root, "tests/phase82/live-results.json"), "utf8");
  assert.doesNotMatch(raw, /sk-[a-zA-Z0-9]{8,}/);
  assert.doesNotMatch(raw, /apiKey|oauth_token|Bearer /);
});

test("only smoke-verified models enter production", () => {
  const live = loadLiveResults();
  const qualified = applyQualification(MODEL_CANDIDATES, live, providerBindings());
  for (const row of qualified) {
    if (inProductionPool(row)) {
      assert.equal(row.verified, true);
      assert.equal(row.capabilities.json, "pass");
      assert.equal(row.capabilities.toolCalling, "pass");
      assert.equal(row.capabilities.harness, "pass");
      const role = row.roles[0];
      if (role === "fast" || role === "long" || role === "vision") assert.equal(row.businessQualified.import, "pass");
      if (role === "vision") assert.equal(row.capabilities.vision, "pass");
      if (role === "reasoning") {
        assert.equal(row.businessQualified.part, "pass");
        assert.equal(row.businessQualified.company, "pass");
      }
    } else {
      assert.equal(row.pool, "candidate");
    }
  }
  const router = createModelRouter({ live, bindings: providerBindings() });
  const premium = router.resolve({ kind: "part", role: "premium" });
  assert.equal(premium.ok, false, "unverified grok must not auto-select");
  const vision = router.resolve({ kind: "import", sourceType: "image" });
  const visionProd = qualified.find((row) => row.roles.includes("vision") && inProductionPool(row));
  if (visionProd) {
    assert.equal(vision.ok, true);
    assert.equal(vision.model, visionProd.model);
  } else {
    assert.equal(vision.ok, false, "unverified vision must not auto-select");
  }
});

test("result-driven escalation stays off the caller flag", () => {
  assert.equal(nextEscalationRole("part", { ok: true, verdict: { confidence: "low" }, evidence: [] }, "reasoning"), "premium");
  assert.equal(nextEscalationRole("import", { candidates: [{ warnings: [{ code: "mpn_provenance" }] }] }, "fast"), "reasoning");
  assert.notEqual(nextEscalationRole("import", { candidates: [{ warnings: [{ code: "mpn_provenance" }] }] }, "fast"), "premium");
});
