/**
 * Plugin v0.1.0 RC — presentation is display-only and lossless.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "../../electronics-agent-plugin");
const present = await import(join(pluginRoot, "src/present.js"));

test("part presentation copies MPN and evidenceId without completing suffixes", () => {
  const text = present.presentPartMarkdown({
    ok: true,
    mpn: "TPS54560DDAR",
    identity: { brand: "TI", package: "SO-PowerPAD-8" },
    verdict: {
      state: "可报价观察",
      confidence: "medium",
      claims: [{ text: "立创可识别该料号", evidenceId: "ev_lcsc_1" }],
    },
    evidence: [{ id: "ev_lcsc_1", sourceKey: "lcsc", title: "LCSC" }],
    supply: { offerCount: 3, lcscStock: 12 },
    cards: { price: { level: "unknown" }, supply: { verdict: "有挂货" } },
    advice: { usedInternal: false },
  });
  assert.match(text, /型号：TPS54560DDAR/);
  assert.doesNotMatch(text, /型号：TPS54560[^D]/);
  assert.match(text, /〔ev_lcsc_1〕/);
  assert.doesNotMatch(text, /综合建议：先补市场证据/);
});

test("import presentation keeps candidate cells and does not wrap vision_unavailable as success", () => {
  const fail = present.presentImportMarkdown({
    ok: false,
    error: "vision_unavailable",
    sourceType: "image",
    candidates: [],
  });
  assert.match(fail, /^# 导入失败/m);
  assert.match(fail, /vision_unavailable/);
  assert.match(fail, /未生成任何候选行/);
  assert.doesNotMatch(fail, /^# 导入候选/m);
  assert.doesNotMatch(fail, /TPS54560DDAR/);

  const ok = present.presentImportMarkdown({
    ok: true,
    sourceType: "csv",
    candidates: [{ mpn: "TPS54560DDAR", brand: "TI", qty: 10000, dateCode: "2432", price: 1.25 }],
  });
  assert.match(ok, /\| TPS54560DDAR \| TI \| 10000 \| 2432 \| 1.25 \|/);
});

test("company presentation stays unknown without evidence and does not invent contacts", () => {
  const text = present.presentCompanyMarkdown({
    ok: true,
    company: "TI",
    profile: { identity: { name: "TI", companyType: "unknown" }, mainBrands: [], topMpns: [] },
    evidence: [],
    verdict: { state: "未知", claims: [] },
  });
  assert.match(text, /公司：TI/);
  assert.match(text, /未知（无 evidence，不编造）/);
  assert.match(text, /不编造注册资本、联系人或代理线/);
  assert.doesNotMatch(text, /注册资本：/);
  assert.doesNotMatch(text, /联系人：/);
});
