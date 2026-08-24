import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

async function waitHealth(baseUrl) {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return;
    } catch {
      // Server startup.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("health timeout");
}

test("HTTP production guards expose safe metrics and stable rejection codes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "electronics-http-ops-"));
  const token = "http-ops-secret-token";
  const port = 18814;
  const child = spawn(process.execPath, [join(root, "apps/agent-api/src/index.js")], {
    cwd: root,
    env: {
      ...process.env,
      AGENT_API_HOST: "127.0.0.1",
      AGENT_API_PORT: String(port),
      AGENT_API_TOKEN: token,
      TASK_STORE_PATH: join(dir, "tasks.sqlite"),
      AGENT_MAX_BODY_BYTES: "64",
      AGENT_RATE_LIMIT_PER_MINUTE: "2",
      ELECTRONICS_IGNORE_LIVE: "1",
      DEEPSEEK_API_KEY: "",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitHealth(baseUrl);
    const health = await fetch(`${baseUrl}/health`, { headers: { "x-request-id": "../../unsafe" } });
    assert.equal(health.status, 200);
    assert.notEqual(health.headers.get("x-request-id"), "../../unsafe");

    const denied = await fetch(`${baseUrl}/metrics`);
    assert.equal(denied.status, 401);
    assert.deepEqual(await denied.json(), { ok: false, error: "unauthorized" });

    const oversized = await fetch(`${baseUrl}/v1/hello`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ token: "x".repeat(100) }),
    });
    assert.equal(oversized.status, 413);
    assert.deepEqual(await oversized.json(), { ok: false, error: "payload_too_large" });

    const metrics = await fetch(`${baseUrl}/metrics`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(metrics.status, 200);
    const snapshot = await metrics.json();
    assert.equal(snapshot.http.payloadTooLarge, 1);
    assert.equal(snapshot.http.unauthorized, 1);
    assert.equal(typeof snapshot.tasks.total, "number");
    assert.equal(JSON.stringify(snapshot).includes(token), false);

    const limited = await fetch(`${baseUrl}/metrics`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "60");
    assert.deepEqual(await limited.json(), { ok: false, error: "rate_limited" });
    assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    assert.equal(stderr.includes(token), false);
    rmSync(dir, { recursive: true, force: true });
  }
});
