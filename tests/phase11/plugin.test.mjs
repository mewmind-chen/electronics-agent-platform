/**
 * Phase 11 — user-side Electronics Agent Plugin.
 * Tools may only HTTP-call Agent API. They must not import Core or write secrets.
 */
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const pluginRoot = join(root, "electronics-agent-plugin");

function pluginFile(rel) {
  return readFileSync(join(pluginRoot, rel), "utf8");
}

async function waitHealth(url, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`health timeout: ${url}`);
}

function spawnApi(port, token) {
  return spawn(process.execPath, [join(root, "apps/agent-api/src/index.js")], {
    cwd: root,
    env: {
      ...process.env,
      AGENT_API_HOST: "127.0.0.1",
      AGENT_API_PORT: String(port),
      AGENT_API_TOKEN: token,
      ELECTRONICS_IGNORE_LIVE: "1",
      ELECTRONICS_HARNESS_STUB: "",
      DEEPSEEK_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function loadPluginTools() {
  return import(join(pluginRoot, "src/index.js")).then(async (mod) => {
    const tools = new Map();
    mod.apply({
      tools: {
        register(tool) {
          tools.set(tool.name, tool);
        },
      },
    });
    return { mod, tools };
  });
}

test("plugin package is a loadable official Harness plugin and does not ship Core", async () => {
  const manifest = JSON.parse(pluginFile("manifest.json"));
  assert.equal(manifest.name, "electronics-agent");
  assert.ok(manifest.version);
  assert.ok(String(manifest.description).length > 8);
  assert.deepEqual(manifest.tools.map((t) => t.name).sort(), ["company_research", "import_extract", "part_research"]);
  assert.equal(manifest.requiredEndpoint, "/v1");
  assert.match(JSON.stringify(manifest.permissions), /Agent API|network/i);
  assert.equal(manifest.permissions?.database, false);

  const pkg = JSON.parse(pluginFile("package.json"));
  assert.equal(pkg.private, true);
  assert.equal(pkg.dsh.bundle.patch, "./cordis.patch.yml");
  const deps = JSON.stringify({ ...pkg.dependencies, ...pkg.peerDependencies });
  assert.doesNotMatch(deps, /import-core|part-intelligence|company-intelligence|model-policy/);

  const sources = [];
  function collectJs(rel) {
    const abs = join(pluginRoot, rel);
    for (const name of readdirSync(abs, { withFileTypes: true })) {
      const next = join(rel, name.name);
      if (name.isDirectory()) collectJs(next);
      else if (name.name.endsWith(".js")) sources.push(pluginFile(next));
    }
  }
  collectJs("src");
  collectJs("tools");
  const blob = sources.join("\n");
  assert.doesNotMatch(blob, /@electronics\/(import-core|part-intelligence-core|company-intelligence-core)/);
  assert.doesNotMatch(blob, /writeFileSync/);
  assert.doesNotMatch(blob, /FIRECRAWL_API_KEY|DATABASE_URL/);
  assert.match(blob, /\/v1\/parts\/research/);
  assert.match(blob, /\/v1\/import\/extract/);
  assert.match(blob, /\/v1\/companies\/research/);

  const { mod, tools } = await loadPluginTools();
  assert.equal(mod.name, "electronics-agent");
  assert.deepEqual(mod.inject, ["tools", "skills"]);
  assert.equal(tools.has("confirmImport"), false);
  for (const name of ["part_research", "import_extract", "company_research"]) {
    assert.equal(typeof tools.get(name)?.execute, "function", name);
  }
});

test("skills are user-invocable and forbid writing a business database", () => {
  const files = {
    "part-analysis.md": ["part_research", "Evidence", "Never write"],
    "import-analysis.md": ["import_extract", "Candidate", "Never write"],
    "company-analysis.md": ["company_research", "Never write"],
  };
  for (const [name, needles] of Object.entries(files)) {
    const text = pluginFile(join("skills", name));
    assert.match(text, /user-invocable:\s*true/);
    for (const needle of needles) assert.match(text, new RegExp(needle, "i"), `${name} ${needle}`);
    assert.doesNotMatch(text, /INSERT INTO/i);
  }
  assert.match(pluginFile("skills/part-analysis.md"), /TPS54560DDAR|MPN|型号/);
});

test("plugin tools call the real Agent API for part, import, and company", async () => {
  const port = 18711;
  const token = "phase11-plugin-token";
  const child = spawnApi(port, token);
  try {
    await waitHealth(`http://127.0.0.1:${port}/health`);
    const prevUrl = process.env.AGENT_API_URL;
    const prevTok = process.env.ELECTRONICS_AGENT_PLATFORM_TOKEN;
    process.env.AGENT_API_URL = `http://127.0.0.1:${port}`;
    process.env.ELECTRONICS_AGENT_PLATFORM_TOKEN = token;
    try {
      const { tools } = await loadPluginTools();

      const part = await tools.get("part_research").execute({ mpn: "TPS54560DDAR", steps: ["hqew"], mode: "core" });
      assert.equal(part.ok, true, JSON.stringify(part).slice(0, 400));
      assert.equal(part.mpn, "TPS54560DDAR");
      assert.ok(Array.isArray(part.evidence));
      assert.equal(part.confirmImport, undefined);

      const imported = await tools.get("import_extract").execute({
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
      assert.equal(imported.ok !== false, true, JSON.stringify(imported).slice(0, 400));
      assert.equal(imported.candidates[0].mpn, "TPS54560DDAR");
      assert.equal(imported.candidates[0].qty, 10000);
      assert.equal(imported.candidates[0].selected, undefined);

      const company = await tools.get("company_research").execute({ company: "TI", steps: ["gys"], mode: "core" });
      assert.equal(company.ok, true, JSON.stringify(company).slice(0, 400));
      assert.equal(company.company, "TI");
    } finally {
      if (prevUrl == null) delete process.env.AGENT_API_URL;
      else process.env.AGENT_API_URL = prevUrl;
      if (prevTok == null) delete process.env.ELECTRONICS_AGENT_PLATFORM_TOKEN;
      else process.env.ELECTRONICS_AGENT_PLATFORM_TOKEN = prevTok;
    }
  } finally {
    child.kill("SIGTERM");
  }
});

test("plugin returns explicit errors for unauthorized, image-without-vision, and pdf", async () => {
  const port = 18712;
  const token = "phase11-plugin-token";
  const child = spawnApi(port, token);
  try {
    await waitHealth(`http://127.0.0.1:${port}/health`);
    process.env.AGENT_API_URL = `http://127.0.0.1:${port}`;
    process.env.ELECTRONICS_AGENT_PLATFORM_TOKEN = "wrong-token";
    const { tools } = await loadPluginTools();
    const denied = await tools.get("part_research").execute({ mpn: "TPS54560DDAR", mode: "core" });
    assert.equal(denied.ok, false);
    assert.equal(denied.error, "unauthorized");

    process.env.ELECTRONICS_AGENT_PLATFORM_TOKEN = token;
    const { tools: tools2 } = await loadPluginTools();
    const image = await tools2.get("import_extract").execute({
      kind: "offer",
      sourceType: "image",
      mime: "image/png",
      filename: "quote.png",
      fileBase64: Buffer.from("not-a-real-png").toString("base64"),
    });
    assert.equal(image.ok, false);
    assert.equal(image.error, "vision_unavailable");
    assert.deepEqual(image.candidates || [], []);
    assert.deepEqual(image, JSON.parse(JSON.stringify(image)));

    const pdf = await tools2.get("import_extract").execute({
      kind: "offer",
      sourceType: "pdf",
      filename: "bom.pdf",
      fileBase64: Buffer.from("%PDF-1.4").toString("base64"),
    });
    assert.equal(pdf.ok, false);
    assert.ok(pdf.error || pdf.reason);
    assert.match(String(pdf.error || pdf.reason), /agent_unavailable|unstructured|needsAgent|pdf/i);
  } finally {
    delete process.env.AGENT_API_URL;
    delete process.env.ELECTRONICS_AGENT_PLATFORM_TOKEN;
    child.kill("SIGTERM");
  }
});
