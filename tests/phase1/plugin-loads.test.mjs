import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("official dsh --dump-config includes electronics-hello and not MCP hqb", () => {
  spawnSync(process.execPath, [join(root, "scripts/write-overlays.mjs")], {
    cwd: root,
    encoding: "utf8",
  });
  const r = spawnSync(
    "dsh",
    ["--profile", "headless", "--patch", join(root, "runtime/hello.cordis.yml"), "--dump-config"],
    { cwd: root, encoding: "utf8", timeout: 60_000 },
  );
  const out = `${r.stdout}\n${r.stderr}`;
  assert.equal(r.status, 0, out);
  assert.match(out, /electronics-hello/);
  assert.match(out, /dsh-hello\/src\/index\.js/);
  assert.match(out, /electronics-import/);
  assert.match(out, /dsh-import\/src\/index\.js/);
  assert.match(out, /electronics-part/);
  assert.match(out, /electronics-company/);
  assert.doesNotMatch(out, /serverName:\s*hqb/);
  assert.doesNotMatch(out, /runImportAgent/);
  assert.doesNotMatch(out, /heuristicParse/);
});
