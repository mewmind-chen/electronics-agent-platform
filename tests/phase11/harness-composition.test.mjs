import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const pluginRoot = join(root, "electronics-agent-plugin");

test("plugin jsonrpc composition does not load Platform internal dsh-* tools", () => {
  const cordis = readFileSync(join(pluginRoot, "jsonrpc.cordis.yml"), "utf8");
  const patch = readFileSync(join(pluginRoot, "cordis.patch.yml"), "utf8");
  assert.match(cordis, /id: electronics-agent/);
  assert.match(cordis, /\.\/src\/index\.js/);
  assert.doesNotMatch(cordis, /@electronics\/dsh-(hello|import|part|company)/);
  assert.doesNotMatch(patch, /@electronics\/dsh-(hello|import|part|company)/);
  assert.doesNotMatch(cordis, /admit-images/);
});
