/**
 * Plugin v0.1.0 RC — explicit config, pack contents, no secrets, frozen tools.
 */
import { execFileSync } from "node:child_process";
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

function collectPluginSources() {
  const out = [];
  function walk(rel) {
    const abs = join(pluginRoot, rel);
    for (const ent of readdirSync(abs, { withFileTypes: true })) {
      if (ent.name === "node_modules") continue;
      const next = join(rel, ent.name);
      if (ent.isDirectory()) walk(next);
      else if (/\.(js|json|md|yml)$/.test(ent.name)) out.push({ rel: next, text: pluginFile(next) });
    }
  }
  walk("src");
  walk("tools");
  walk("skills");
  out.push({ rel: "manifest.json", text: pluginFile("manifest.json") });
  out.push({ rel: "package.json", text: pluginFile("package.json") });
  out.push({ rel: "cordis.patch.yml", text: pluginFile("cordis.patch.yml") });
  out.push({ rel: "README.md", text: pluginFile("README.md") });
  return out;
}

async function loadTools() {
  const mod = await import(join(pluginRoot, "src/index.js"));
  const tools = new Map();
  mod.apply({
    tools: { register(tool) { tools.set(tool.name, tool); } },
  });
  return tools;
}

test("missing AGENT_API_URL is configuration_error, not a silent localhost fallback", async () => {
  const prevUrl = process.env.AGENT_API_URL;
  const prevTok = process.env.ELECTRONICS_AGENT_PLATFORM_TOKEN;
  delete process.env.AGENT_API_URL;
  process.env.ELECTRONICS_AGENT_PLATFORM_TOKEN = "rc-token";
  try {
    const tools = await loadTools();
    const result = await tools.get("part_research").execute({ mpn: "TPS54560DDAR", mode: "core" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "configuration_error");
    assert.doesNotMatch(JSON.stringify(result), /127\.0\.0\.1:8787/);
  } finally {
    if (prevUrl == null) delete process.env.AGENT_API_URL;
    else process.env.AGENT_API_URL = prevUrl;
    if (prevTok == null) delete process.env.ELECTRONICS_AGENT_PLATFORM_TOKEN;
    else process.env.ELECTRONICS_AGENT_PLATFORM_TOKEN = prevTok;
  }
});

test("missing ELECTRONICS_AGENT_PLATFORM_TOKEN is authentication_configuration_error", async () => {
  const prevUrl = process.env.AGENT_API_URL;
  const prevTok = process.env.ELECTRONICS_AGENT_PLATFORM_TOKEN;
  process.env.AGENT_API_URL = "http://127.0.0.1:65500";
  delete process.env.ELECTRONICS_AGENT_PLATFORM_TOKEN;
  try {
    const tools = await loadTools();
    const result = await tools.get("import_extract").execute({ sourceType: "image", kind: "offer" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "authentication_configuration_error");
    assert.deepEqual(result.candidates, []);
  } finally {
    if (prevUrl == null) delete process.env.AGENT_API_URL;
    else process.env.AGENT_API_URL = prevUrl;
    if (prevTok == null) delete process.env.ELECTRONICS_AGENT_PLATFORM_TOKEN;
    else process.env.ELECTRONICS_AGENT_PLATFORM_TOKEN = prevTok;
  }
});

test("configuration failures render as explicit failures, not successful reports", async () => {
  const tools = await loadTools();
  const part = tools.get("part_research").output.render({ mpn: "TPS54560DDAR" }, {
    ok: false,
    error: "configuration_error",
  });
  const text = part.map((b) => b.text || "").join("\n");
  assert.match(text, /configuration_error/);
  assert.doesNotMatch(text, /综合建议：按公开市场/);
});

test("tools do not accept token parameters and client has no localhost default", () => {
  const client = pluginFile("tools/client.js");
  assert.doesNotMatch(client, /127\.0\.0\.1:8787/);
  assert.match(client, /configuration_error/);
  assert.match(client, /authentication_configuration_error/);
  const index = pluginFile("src/index.js");
  assert.doesNotMatch(index, /token\s*:/);
  assert.doesNotMatch(index, /ELECTRONICS_AGENT_PLATFORM_TOKEN/);
  const manifest = JSON.parse(pluginFile("manifest.json"));
  assert.deepEqual(manifest.tools.map((t) => t.name).sort(), ["company_research", "import_extract", "part_research"]);
  assert.equal(manifest.tools.some((t) => /chat|radar|workbench|vision/i.test(t.name)), false);
});

test("npm pack of the plugin ships only the runtime surface", () => {
  const packed = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: pluginRoot,
    encoding: "utf8",
  });
  const report = JSON.parse(packed);
  const files = (report[0]?.files || report.files || []).map((f) => f.path || f);
  assert.ok(files.includes("src/index.js"));
  assert.ok(files.includes("src/present.js"));
  assert.ok(files.includes("tools/client.js"));
  assert.ok(files.includes("skills/part-analysis.md"));
  assert.ok(files.includes("manifest.json"));
  assert.ok(files.includes("cordis.patch.yml"));
  assert.ok(files.includes("README.md"));
  const blob = files.join("\n");
  assert.doesNotMatch(blob, /node_modules/);
  assert.doesNotMatch(blob, /jsonrpc\.cordis\.yml/);
  assert.doesNotMatch(blob, /live-harness/);
  assert.doesNotMatch(blob, /\.dsh\//);
  assert.doesNotMatch(blob, /credentials/);
  assert.doesNotMatch(blob, /\.env/);
  assert.doesNotMatch(blob, /dsh-part|dsh-import|dsh-company/);
});

test("plugin sources contain no secrets, profile paths, or Platform internals", () => {
  const sources = collectPluginSources();
  const code = sources
    .filter((s) => !s.rel.endsWith("README.md"))
    .map((s) => s.text)
    .join("\n");
  const blob = sources.map((s) => s.text).join("\n");
  assert.doesNotMatch(code, /@electronics\/(contracts|import-core|part-intelligence-core|company-intelligence-core|dsh-)/);
  assert.doesNotMatch(code, /packages\/dsh-(hello|import|part|company)/);
  assert.doesNotMatch(blob, /FIRECRAWL_API_KEY|DEEPSEEK_API_KEY\s*=/);
  assert.doesNotMatch(blob, /Users\/ylf/);
  assert.doesNotMatch(code, /\.dsh\/profiles/);
  assert.doesNotMatch(blob, /pnpm\/store/);
  assert.doesNotMatch(blob, /sk-[a-zA-Z0-9]{10,}/);
  for (const file of sources) {
    if (!/\.(js|json|yml)$/.test(file.rel)) continue;
    assert.doesNotMatch(file.text, /ELECTRONICS_AGENT_PLATFORM_TOKEN\s*[:=]\s*["'][^"'$]+["']/);
  }
  const pkg = JSON.parse(pluginFile("package.json"));
  assert.equal(pkg.version, "0.1.0");
  assert.ok(Array.isArray(pkg.files));
});
