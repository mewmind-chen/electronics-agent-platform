import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRuntime, createSessionId } from "../../apps/agent-api/src/runtime.js";
import { extractNamedTool, loadOfficialTools } from "../../apps/agent-api/src/harness-dispatch.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(import.meta.url);

test("official plugins register defineTool objects used by the runtime", async () => {
  const tools = loadOfficialTools();
  for (const name of ["hello_ping", "import_normalize_text", "import_validate_mapping", "import_validate_rows", "part_research", "company_research"]) {
    const tool = tools.get(name);
    assert.ok(tool, name);
    assert.equal(typeof tool.execute, "function");
    assert.equal(tool.name, name);
  }
});

test("official part tool returns lossless JSON when optional business fields are absent", async () => {
  const tool = loadOfficialTools().get("part_research");
  const result = await tool.execute({ mpn: "NE555P", steps: [] });
  assert.deepEqual(result, JSON.parse(JSON.stringify(result)));
  assert.equal(result.ok, true);
  assert.equal(result.mpn, "NE555P");
});

test("official Harness session ids cannot collide within the same millisecond", () => {
  const ids = new Set(Array.from({ length: 100 }, () => createSessionId("company")));
  assert.equal(ids.size, 100);
  assert.ok([...ids].every((id) => id.startsWith("company-")));
});

test("test stub may execute official tools but must not claim viaHarness/usedAi", async () => {
  const runtime = createRuntime({ env: { ELECTRONICS_HARNESS_STUB: "1", DEEPSEEK_API_KEY: "" } });
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
    mode: "core",
  });
  assert.equal(mapped.ok, true);
  assert.equal(mapped.viaHarness, false);
  assert.equal(mapped.route, "core");

  const unstructured = await runtime.runImport({
    kind: "offer",
    sourceType: "text",
    text: "老陈那边 TI TPS54560DDAR 还有一批 大概10K",
    mode: "auto",
  });
  assert.equal(unstructured.ok, true);
  assert.equal(unstructured.viaHarness, false);
  assert.equal(unstructured.usedAi, false);
  assert.equal(unstructured.route, "stub");
  assert.ok(unstructured.toolsCalled.includes("import_classify"));
  assert.ok(unstructured.toolsCalled.includes("import_normalize_text"));
  assert.ok(unstructured.toolsCalled.includes("import_validate_rows"));
  assert.equal(unstructured.candidates[0].mpn, "TPS54560DDAR");
});

test("default part/company stay on core; test stub can still hit official research tools", async () => {
  const runtime = createRuntime({ env: { ELECTRONICS_HARNESS_STUB: "1", DEEPSEEK_API_KEY: "" } });
  const partCore = await runtime.runPartResearch({ mpn: "NE555P", steps: ["hqew"], mode: "core" });
  assert.equal(partCore.ok, true);
  assert.equal(partCore.viaHarness, false);
  assert.equal(partCore.route, "core");

  const partAgent = await runtime.runPartResearch({ mpn: "NE555P", steps: ["hqew"], mode: "auto" });
  assert.equal(partAgent.ok, true);
  assert.equal(partAgent.viaHarness, false);
  assert.equal(partAgent.route, "stub");
  assert.ok(partAgent.toolsCalled.includes("part_research"));
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

test("production HTTP default does not advertise stub as Harness", async () => {
  const port = 18791;
  const child = spawn(process.execPath, [join(root, "apps/agent-api/src/index.js")], {
    cwd: root,
    env: {
      ...process.env,
      AGENT_API_PORT: String(port),
      ELECTRONICS_HARNESS_STUB: "",
      ELECTRONICS_IGNORE_LIVE: "1",
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
        mode: "auto",
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.viaHarness, false);
    assert.equal(body.usedAi, false);
    assert.notEqual(body.route, "stub");

    const forced = await fetch(`http://127.0.0.1:${port}/v1/parts/research`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mpn: "NE555P", steps: ["hqew"], mode: "agent" }),
    });
    const part = await forced.json();
    assert.equal(part.ok, false);
    assert.equal(part.error, "agent_unavailable");
    assert.equal(part.viaHarness, false);
  } finally {
    child.kill("SIGTERM");
  }
});

test("extractNamedTool keeps import tool names when JSON is already in finalResponse", () => {
  const extracted = extractNamedTool(
    {
      finalResponse: '{"candidates":[{"mpn":"TPS54560DDAR","qty":10000}]}',
      events: [{ type: "tool/call", data: { name: "import_validate_rows", arguments: "{}" } }],
    },
    "import_",
  );
  assert.equal(extracted.value.candidates[0].mpn, "TPS54560DDAR");
  assert.equal(extracted.toolsCalled.includes("import_validate_rows"), true);
});

test("extractNamedTool never mistakes failed tool-call arguments for a result", () => {
  const extracted = extractNamedTool(
    {
      finalResponse: "part_research failed: value is not lossless JSON",
      events: [
        {
          type: "tool/call",
          data: {
            name: "part_research",
            arguments: '{"mpn":"TPS54560DDAR","goal":"research"}',
          },
        },
        {
          type: "tool/result",
          data: {
            message: {
              content: [
                {
                  type: "tool-result",
                  content: [{ type: "text", text: 'Error: tool "part_research" returned invalid output' }],
                  isError: true,
                },
              ],
            },
          },
        },
      ],
    },
    "part_research",
  );
  assert.equal(extracted, null);
});
