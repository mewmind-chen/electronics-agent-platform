import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

async function waitHealth(url) {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`health timeout: ${url}`);
}

async function request(baseUrl, path, { method = "GET", token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { res, body: await res.json() };
}

test("task resources require the API token while health remains public and non-sensitive", async () => {
  const port = 18804;
  const token = "phase9-boundary-token";
  const child = spawn(process.execPath, [join(root, "apps/agent-api/src/index.js")], {
    cwd: root,
    env: {
      ...process.env,
      AGENT_API_PORT: String(port),
      AGENT_API_TOKEN: token,
      ELECTRONICS_IGNORE_LIVE: "1",
      DEEPSEEK_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitHealth(`${baseUrl}/health`);
    const health = await request(baseUrl, "/health");
    assert.equal(health.res.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(JSON.stringify(health.body).includes(token), false);

    const created = await request(baseUrl, "/v1/tasks", {
      method: "POST",
      body: { type: "part_research", input: { mpn: "NE555P", mode: "core" } },
    });
    assert.equal(created.res.status, 401);

    for (const suffix of ["", "/events", "/result"]) {
      const denied = await request(baseUrl, `/v1/tasks/not-a-real-task${suffix}`);
      assert.equal(denied.res.status, 401, suffix || "task");
    }

    const allowedCreate = await request(baseUrl, "/v1/tasks", {
      method: "POST",
      token,
      body: { type: "part_research", input: { mpn: "NE555P", mode: "core" } },
    });
    assert.equal(allowedCreate.res.status, 202, JSON.stringify(allowedCreate.body));
    for (const suffix of ["", "/events", "/result"]) {
      const allowed = await request(baseUrl, `/v1/tasks/${allowedCreate.body.taskId}${suffix}`, { token });
      assert.equal(allowed.res.status, 200, suffix || "task");
    }
  } finally {
    child.kill("SIGTERM");
  }
});

test("research and task entrypoints reject invalid contracts before creating work", async () => {
  const port = 18805;
  const token = "phase9-contract-token";
  const child = spawn(process.execPath, [join(root, "apps/agent-api/src/index.js")], {
    cwd: root,
    env: {
      ...process.env,
      AGENT_API_PORT: String(port),
      AGENT_API_TOKEN: token,
      ELECTRONICS_IGNORE_LIVE: "1",
      DEEPSEEK_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitHealth(`${baseUrl}/health`);
    const cases = [
      ["/v1/parts/research", { mpn: "NE555P", mode: "not-a-mode" }],
      ["/v1/parts/research", { steps: ["hqew"] }],
      ["/v1/companies/research", { company: "", steps: ["gys"] }],
      ["/v1/parts/research", { mpn: "NE555P", confirmImport: true }],
      ["/v1/parts/research", { mpn: "NE555P", context: { inventory: "not-an-object" } }],
      ["/v1/import/extract", { kind: "offer", sourceType: "made-up" }],
      ["/v1/import/extract", { kind: "offer", sourceType: "text", confirmImport: true }],
      ["/v1/chat", { message: "" }],
      ["/v1/chat", { message: "分析 NE555P", context: { quotation: "not-an-object" } }],
      ["/v1/tasks", { type: "not-a-task", input: { mpn: "NE555P" } }],
      ["/v1/tasks", { type: "part_research", input: { context: { quotation: "not-an-object" } } }],
    ];
    for (const [path, body] of cases) {
      const out = await request(baseUrl, path, { method: "POST", token, body });
      assert.equal(out.res.status, 422, `${path}: ${JSON.stringify(out.body)}`);
      assert.equal(out.body.ok, false);
      assert.equal(out.body.error, "contract_error");
      assert.ok(Array.isArray(out.body.errors));
    }

    const accepted = await request(baseUrl, "/v1/parts/research", {
      method: "POST",
      token,
      body: {
        mpn: "NE555P",
        mode: "core",
        steps: ["hqew"],
        context: { inventory: { source: "radar", onHand: 2 }, quotation: { source: "workbench", openCount: 1 } },
      },
    });
    assert.equal(accepted.res.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.ok, true);
    assert.equal(accepted.body.businessContext.inventory.origin, "radar");
  } finally {
    child.kill("SIGTERM");
  }
});
