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

test("GET /health does not require a model turn", async () => {
  const port = 18787;
  const child = spawn(process.execPath, [join(root, "apps/agent-api/src/index.js")], {
    cwd: root,
    env: { ...process.env, AGENT_API_PORT: String(port), AGENT_API_HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = [];
  child.stderr.on("data", (c) => logs.push(String(c)));
  try {
    await waitHealth(`http://127.0.0.1:${port}/health`);
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.service, "electronics-agent-api");
    assert.equal(typeof body.contractVersion, "string");
    assert.ok(body.routes.includes("/v1/hello"));
    assert.ok(body.routes.includes("/v1/import/extract"));
    assert.ok(body.routes.includes("/v1/parts/research"));
    assert.equal(typeof body.agent.available, "boolean");
    assert.equal(body.agent.modeDefault, "auto");
    assert.equal(typeof body.agent.policy.provider, "string");
  } finally {
    child.kill("SIGTERM");
  }
});
