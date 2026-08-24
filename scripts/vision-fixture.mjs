import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const VISION_FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../tests/phase82/fixtures/quote-tps54560.png",
);

export function visionImportPayload() {
  const fileBase64 = readFileSync(VISION_FIXTURE_PATH).toString("base64");
  return {
    kind: "offer",
    sourceType: "image",
    mime: "image/png",
    filename: "quote-tps54560.png",
    fileBase64,
  };
}
