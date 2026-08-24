import test from "node:test";
import assert from "node:assert/strict";
import { createModelRouter } from "../../packages/model-policy/src/index.js";
import { productionFixture } from "../../packages/model-policy/src/fixture.js";
import { createRuntime, importAgentInput } from "../../apps/agent-api/src/runtime.js";

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function visionRuntime(officialRunAgent) {
  return createRuntime({
    env: { ELECTRONICS_HARNESS_STUB: "" },
    harnessAvailable: true,
    router: createModelRouter({ registry: productionFixture() }),
    officialRunAgent,
  });
}

test("qualified image import selects the official vision model", () => {
  const router = createModelRouter({ registry: productionFixture() });
  const route = router.resolve({ kind: "import", sourceType: "image", mime: "image/png" });
  assert.equal(route.ok, true);
  assert.equal(route.role, "vision");
  assert.equal(route.model, "deepseek-v4-flash-vision-exp");
  assert.equal(route.provider, "deepseek-official");
});

test("image import returns the vision harness result and does not fall through to fast", async () => {
  const roles = [];
  const runtime = visionRuntime(async (job) => {
    roles.push(job.input.role || "default");
    assert.equal(job.kind, "import");
    return {
      ok: true,
      candidates: [{ kind: "offer", mpn: "TPS54560DDAR", qty: 10000, dateCode: "2418", priceAmount: 1.15 }],
      usedAi: true,
      viaHarness: true,
      toolsCalled: ["import_validate_rows"],
    };
  });
  const out = await runtime.runImport({
    kind: "offer",
    sourceType: "image",
    mime: "image/png",
    filename: "quote.png",
    fileBase64: PNG_1X1,
    mode: "agent",
  });
  assert.equal(out.ok, true);
  assert.equal(out.error, undefined);
  assert.equal(out.candidates[0].mpn, "TPS54560DDAR");
  assert.equal(out.viaHarness, true);
  assert.equal(out.modelRoute.role, "vision");
  assert.equal(out.modelRoute.model, "deepseek-v4-flash-vision-exp");
  assert.deepEqual(roles, ["vision"]);
  assert.equal(runtime.harnessStarts, 1);
});

test("image import stays empty when no vision model is available", async () => {
  const runtime = createRuntime({
    env: { ELECTRONICS_HARNESS_STUB: "" },
    harnessAvailable: true,
    router: createModelRouter({ live: [] }),
    officialRunAgent: async () => {
      throw new Error("should not start harness without a vision model");
    },
  });
  const out = await runtime.runImport({
    kind: "offer",
    sourceType: "image",
    mime: "image/png",
    fileBase64: PNG_1X1,
    mode: "agent",
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, "vision_unavailable");
  assert.deepEqual(out.candidates, []);
  assert.equal(runtime.harnessStarts, 0);
});

test("vision import prompt sends an image block and omits raw fileBase64 from text", () => {
  const input = {
    kind: "offer",
    sourceType: "image",
    mime: "image/png",
    filename: "quote.png",
    fileBase64: PNG_1X1,
    role: "vision",
  };
  const blocks = importAgentInput(input);
  assert.equal(Array.isArray(blocks), true);
  assert.equal(blocks[0].type, "text");
  assert.doesNotMatch(blocks[0].text, new RegExp(PNG_1X1));
  assert.match(blocks[0].text, /attached image|image block/i);
  assert.match(blocks[0].text, /import_validate_rows/);
  assert.doesNotMatch(blocks[0].text, /import_table_preview|import_apply_mapping/);
  const image = blocks.find((block) => block.type === "image");
  assert.equal(image.mediaType, "image/png");
  assert.equal(image.data, PNG_1X1);
  assert.equal(image.attachment, undefined);
});
