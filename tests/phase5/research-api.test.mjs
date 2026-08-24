import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

async function waitHealth(url) {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("health timeout");
}

test("parts and companies research routes return contracts, not SQL", async () => {
  const port = 18790;
  const child = spawn(process.execPath, [join(root, "apps/agent-api/src/index.js")], {
    cwd: root,
    env: { ...process.env, AGENT_API_PORT: String(port), ELECTRONICS_HARNESS_STUB: "", DEEPSEEK_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitHealth(`http://127.0.0.1:${port}/health`);
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.ok(health.routes.includes("/v1/parts/research"));
    assert.ok(health.routes.includes("/v1/companies/research"));

    const part = await (
      await fetch(`http://127.0.0.1:${port}/v1/parts/research`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mpn: "NE555P", steps: ["hqew"] }),
      })
    ).json();
    assert.equal(part.ok, true);
    assert.equal(part.mpn, "NE555P");
    assert.equal(part.verdict.state, "未知");

    const company = await (
      await fetch(`http://127.0.0.1:${port}/v1/companies/research`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ company: "测试电子", steps: ["gys"] }),
      })
    ).json();
    assert.equal(company.ok, true);
    assert.equal(company.company, "测试电子");
  } finally {
    child.kill("SIGTERM");
  }
});
