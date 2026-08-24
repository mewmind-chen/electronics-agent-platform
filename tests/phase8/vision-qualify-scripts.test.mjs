import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("live-qualify actually probes vision instead of hard-failing the role", () => {
  const src = readFileSync(join(root, "scripts/live-qualify.mjs"), "utf8");
  assert.equal(src.includes("out.checks.vision = false"), false);
  assert.match(src, /deepseek-official\/deepseek-v4-flash-vision-exp/);
  assert.match(src, /importAgentInput/);
  assert.match(src, /visionImportPayload/);
});

test("live-business-qualify runs import against the official vision model", () => {
  const src = readFileSync(join(root, "scripts/live-business-qualify.mjs"), "utf8");
  assert.match(src, /deepseek-official\/deepseek-v4-flash-vision-exp/);
  assert.match(src, /quote-photo\.png|VISION_QUOTE|visionImportPayload|importAgentInput/);
});

test("vision quote fixture is a real PNG the qualifier can attach", async () => {
  const { VISION_FIXTURE_PATH, visionImportPayload } = await import("../../scripts/vision-fixture.mjs");
  const png = readFileSync(VISION_FIXTURE_PATH);
  assert.equal(png[0], 0x89);
  assert.equal(png[1], 0x50);
  assert.ok(png.length > 400);
  const payload = visionImportPayload();
  assert.equal(payload.sourceType, "image");
  assert.equal(payload.mime, "image/png");
  assert.equal(Buffer.from(payload.fileBase64, "base64").toString("base64"), payload.fileBase64);
});
