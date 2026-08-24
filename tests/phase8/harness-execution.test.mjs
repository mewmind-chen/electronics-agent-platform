import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRuntime } from "../../apps/agent-api/src/runtime.js";
import { loadOfficialTools } from "../../apps/agent-api/src/harness-dispatch.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(import.meta.url);
process.env.ELECTRONICS_HARNESS_STUB = "1";
process.env.DEEPSEEK_API_KEY = "";

test("official plugins register defineTool objects used by the runtime", async () => {
  const tools = loadOfficialTools();
  for (const name of ["hello_ping", "import_normalize_text", "import_validate_rows", "part_research", "company_research"]) {
    const tool = tools.get(name);
    assert.ok(tool, name);
    assert.equal(typeof tool.execute, "function");
    assert.equal(tool.name, name);
  }
});

test("mapped table stays on deterministic core; unstructured import executes official import tools", async () => {
  const runtime = createRuntime();
  const mapped = await runtime.runImport({
    kind: "offer",
    sourceType: "csv",
    text: "P/N,Available\nTPS54560DDAR,10K\n",
    mapping: {
      columns: [
        { header: "P/N", target: "mpn" },
        { header: "Available", target: "qty" },
      ],
    },
  });
  assert.equal(mapped.ok, true);
  assert.equal(mapped.viaHarness, false);
  assert.equal(mapped.route, "core");
  assert.equal(mapped.candidates[0].mpn, "TPS54560DDAR");

  const unstructured = await runtime.runImport({
    kind: "offer",
    sourceType: "text",
    text: "老陈那边 TI TPS54560DDAR 还有一批 大概10K",
  });
  assert.equal(unstructured.ok, true);
  assert.equal(unstructured.viaHarness, true);
  assert.equal(unstructured.route, "harness");
  assert.equal(unstructured.needsAgent, false);
  assert.ok(unstructured.toolsCalled.includes("import_classify"));
  assert.ok(unstructured.toolsCalled.includes("import_normalize_text"));
  assert.ok(unstructured.toolsCalled.includes("import_validate_rows"));
  assert.equal(unstructured.candidates[0].mpn, "TPS54560DDAR");
  assert.equal(unstructured.candidates[0].qty, 10000);
});

test("default part/company stay on core; viaAgent executes official research tools", async () => {
  const runtime = createRuntime();
  const partCore = await runtime.runPartResearch({ mpn: "NE555P", steps: ["hqew"] });
  assert.equal(partCore.ok, true);
  assert.equal(partCore.viaHarness, false);
  assert.equal(partCore.route, "core");

  const partAgent = await runtime.runPartResearch({ mpn: "NE555P", steps: ["hqew"], viaAgent: true });
  assert.equal(partAgent.ok, true);
  assert.equal(partAgent.viaHarness, true);
  assert.ok(partAgent.toolsCalled.includes("part_research"));

  const companyAgent = await runtime.runCompanyResearch({ company: "测试电子", steps: ["gys"], viaAgent: true });
  assert.equal(companyAgent.ok, true);
  assert.ok(companyAgent.toolsCalled.includes("company_research"));
});

test("import-core / part-core / company-core stay Harness-independent", () => {
  for (const rel of [
    "packages/import-core/src/extract.js",
    "packages/part-intelligence-core/src/research.js",
    "packages/company-intelligence-core/src/index.js",
  ]) {
    const src = readFileSync(join(root, rel), "utf8");
    assert.doesNotMatch(src, /@deepseek-ai/);
    assert.doesNotMatch(src, /defineTool/);
    assert.doesNotMatch(src, /DeepSeekHarness/);
  }
  const pkg = req("../../packages/import-core/package.json");
  assert.equal(JSON.stringify(pkg.dependencies || {}).includes("@deepseek-ai"), false);
});

async function waitHealth(url) {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("health timeout");
}

test("POST /v1/import/extract unstructured path records official tools, not just dump-config", async () => {
  const port = 18791;
  const child = spawn(process.execPath, [join(root, "apps/agent-api/src/index.js")], {
    cwd: root,
    env: {
      ...process.env,
      AGENT_API_PORT: String(port),
      ELECTRONICS_HARNESS_STUB: "1",
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
        sourceType: "text",
        text: "仓库现货 TPS54560DDAR 10K",
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.viaHarness, true);
    assert.ok(body.toolsCalled.includes("import_validate_rows"));
    assert.equal(body.candidates[0].mpn, "TPS54560DDAR");

    const part = await (
      await fetch(`http://127.0.0.1:${port}/v1/parts/research`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mpn: "NE555P", steps: ["hqew"], viaAgent: true }),
      })
    ).json();
    assert.equal(part.viaHarness, true);
    assert.ok(part.toolsCalled.includes("part_research"));
  } finally {
    child.kill("SIGTERM");
  }
});
