/**
 * Phase 12 — plugin presentation layer.
 * Users must see a business report, not raw Tool JSON.
 * Plugin must not import Domain Core or contracts.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const pluginRoot = join(root, "electronics-agent-plugin");

function pluginFile(rel) {
  return readFileSync(join(pluginRoot, rel), "utf8");
}

async function loadPluginTools() {
  const mod = await import(join(pluginRoot, "src/index.js"));
  const tools = new Map();
  mod.apply({
    tools: {
      register(tool) {
        tools.set(tool.name, tool);
      },
    },
  });
  return { mod, tools };
}

function renderText(tool, args, value) {
  const blocks = tool.output.render(args, value);
  return blocks.map((b) => b.text || "").join("\n");
}

test("part_research presents a business report instead of raw Tool JSON", async () => {
  const { tools } = await loadPluginTools();
  const tool = tools.get("part_research");
  const value = {
    ok: true,
    mpn: "TPS54560DDAR",
    identity: { brand: "TI", package: "SO-PowerPAD-8" },
    verdict: { state: "未知", confidence: "low", claims: [] },
    evidence: [],
    supply: {},
    cards: { price: { level: "unknown" } },
    advice: { usedInternal: false },
  };
  const text = renderText(tool, { mpn: "TPS54560DDAR" }, value);
  assert.match(text, /型号分析报告/);
  assert.match(text, /基础信息/);
  assert.match(text, /公开市场判断/);
  assert.match(text, /供应情况/);
  assert.match(text, /价格趋势/);
  assert.match(text, /内部业务判断/);
  assert.match(text, /综合建议/);
  assert.match(text, /TPS54560DDAR/);
  assert.match(text, /Agent 不写/);
  assert.doesNotMatch(text, /^\s*\{/);
  assert.doesNotMatch(text, /"verdict"\s*:/);

  const call = tool.presentCall({ mpn: "TPS54560DDAR" });
  assert.equal(call.card, "generic");
  assert.match(call.title, /TPS54560DDAR/);

  const shown = tool.presentResult({ mpn: "TPS54560DDAR" }, {
    content: [{ type: "text", text }],
    isError: false,
    meta: { markdown: text },
  });
  assert.equal(shown.card, "generic");
  assert.equal(shown.content[0].text, text);
  assert.doesNotMatch(shown.content[0].text, /^\s*\{/);
});

test("import_extract presents candidates and never fabricates vision rows", async () => {
  const { tools } = await loadPluginTools();
  const tool = tools.get("import_extract");

  const failed = {
    ok: false,
    error: "vision_unavailable",
    sourceType: "image",
    candidates: [],
  };
  const failText = renderText(tool, { sourceType: "image" }, failed);
  assert.match(failText, /vision_unavailable/);
  assert.match(failText, /未生成|没有候选|零候选|0 行/);
  assert.doesNotMatch(failText, /TPS54560DDAR/);
  assert.doesNotMatch(failText, /^\s*\{/);

  const okValue = {
    ok: true,
    sourceType: "csv",
    candidates: [{ mpn: "TPS54560DDAR", qty: 10000, brand: "TI" }],
  };
  const okText = renderText(tool, { sourceType: "csv" }, okValue);
  assert.match(okText, /导入候选|候选/);
  assert.match(okText, /TPS54560DDAR/);
  assert.match(okText, /待确认|人工确认|业务系统/);
  assert.doesNotMatch(okText, /"candidates"\s*:/);
});

test("company_research presents sourced facts and unknown without evidence", async () => {
  const { tools } = await loadPluginTools();
  const tool = tools.get("company_research");
  const value = {
    ok: true,
    company: "某某电子",
    profile: { identity: { name: "某某电子", companyType: "unknown" }, mainBrands: [], topMpns: [] },
    evidence: [],
    verdict: { state: "未知", claims: [] },
  };
  const text = renderText(tool, { company: "某某电子" }, value);
  assert.match(text, /公司分析报告/);
  assert.match(text, /某某电子/);
  assert.match(text, /未知/);
  assert.match(text, /Agent 不写/);
  assert.doesNotMatch(text, /^\s*\{/);
  assert.doesNotMatch(text, /"profile"\s*:/);
});

test("plugin presentation module does not import Platform Core or contracts", () => {
  const blob = ["src/index.js", "src/present.js"].map((rel) => pluginFile(rel)).join("\n");
  assert.doesNotMatch(blob, /@electronics\/(contracts|import-core|part-intelligence-core|company-intelligence-core)/);
  assert.match(pluginFile("src/present.js"), /presentPart|型号分析报告/);
});
