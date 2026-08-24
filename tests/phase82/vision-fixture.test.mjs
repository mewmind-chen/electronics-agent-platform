import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { visionImportPayload, VISION_FIXTURE_PATH } from "../../scripts/vision-fixture.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("vision OCR fixture is a real PNG with the regression quote text encoded as pixels", () => {
  const buf = readFileSync(VISION_FIXTURE_PATH);
  assert.equal(buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), true);
  const payload = visionImportPayload();
  assert.equal(payload.sourceType, "image");
  assert.equal(payload.mime, "image/png");
  assert.equal(payload.fileBase64, buf.toString("base64"));
  assert.equal(Buffer.from(payload.fileBase64, "base64").toString("base64"), payload.fileBase64);
});

test("live-qualify no longer hard-fails vision after hello_ping", () => {
  const src = readFileSync(join(root, "scripts/live-qualify.mjs"), "utf8");
  assert.doesNotMatch(src, /checks\.vision = false/);
  assert.match(src, /deepseek-official\/deepseek-v4-flash-vision-exp/);
  assert.match(src, /importAgentInput/);
});
