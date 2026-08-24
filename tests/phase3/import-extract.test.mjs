import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

async function waitHealth(url, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`health timeout: ${url}`);
}

test("POST /v1/import/extract returns candidates for mapped CSV and does not write a DB", async () => {
  const port = 18789;
  const child = spawn(process.execPath, [join(root, "apps/agent-api/src/index.js")], {
    cwd: root,
    env: {
      ...process.env,
      AGENT_API_PORT: String(port),
      AGENT_API_HOST: "127.0.0.1",
      ELECTRONICS_HARNESS_STUB: "",
      DEEPSEEK_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitHealth(`http://127.0.0.1:${port}/health`);
    const res = await fetch(`http://127.0.0.1:${port}/v1/import/extract`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "offer",
        sourceType: "csv",
        text: "P/N,Available\nTPS54560DDAR,10K\n",
        mapping: {
          columns: [
            { header: "P/N", target: "mpn" },
            { header: "Available", target: "qty" },
          ],
        },
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.candidates[0].mpn, "TPS54560DDAR");
    assert.equal(body.candidates[0].qty, 10000);
    assert.equal(body.candidates[0].selected, undefined);
    assert.equal(body.needsAgent, false);
    assert.equal(body.viaHarness, false);
    assert.equal(body.route, "core");

    const pending = await fetch(`http://127.0.0.1:${port}/v1/import/extract`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "offer",
        sourceType: "text",
        text: "老陈那边 TI 54560 还有一批 大概10K",
      }),
    });
    const pendingBody = await pending.json();
    assert.equal(pending.status, 200);
    assert.equal(pendingBody.viaHarness, false);
    assert.equal(pendingBody.usedAi, false);
    assert.notEqual(pendingBody.route, "stub");
  } finally {
    child.kill("SIGTERM");
  }
});
