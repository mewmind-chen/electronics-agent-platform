import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAgentResponse, parsePartResearchResult, validateSkillSop } from "../../../packages/contracts/src/index.js";
import { composePartReport, inferPartIntent, researchPart } from "../../../packages/part-intelligence-core/src/index.js";
import { createRuntime } from "../../../apps/agent-api/src/runtime.js";
import { createModelRouter } from "../../../packages/model-policy/src/index.js";
import { productionFixture } from "../../../packages/model-policy/src/fixture.js";

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(here, "cases.json"), "utf8"));

test("part skill SOP still matches frozen headings after 9.2", () => {
  const skill = readFileSync(join(here, "../../../.dsh/skills/part.md"), "utf8");
  assert.equal(validateSkillSop(skill).ok, true);
  assert.match(skill, /Step 1/);
  assert.match(skill, /交叉验证/);
});

test("20+ eval cases keep MPN, use part skill, and stay unknown without evidence", async () => {
  assert.ok(cases.length >= 20);
  const buckets = new Set(cases.map((c) => c.bucket));
  assert.ok(["A-hot", "B-industrial", "C-cold", "D-risk", "E-bogus", "F-multi"].every((b) => buckets.has(b)));

  const router = createModelRouter({ registry: productionFixture(["opencode-go/deepseek-v4-pro"]) });
  let passed = 0;
  for (const row of cases) {
    const intent = inferPartIntent(`分析 ${row.mpn}`);
    assert.equal(intent.kind, "part_research");
    assert.equal(intent.mpn, row.mpn);
    assert.equal(intent.skill, "part");

    const core = await researchPart({ mpn: row.mpn, steps: ["hqew"] }, {});
    assert.equal(core.ok, true);
    assert.equal(core.mpn, row.mpn);
    const parsed = parsePartResearchResult(core);
    assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
    if (!core.evidence?.length || row.bogus) {
      assert.equal(core.verdict.state, "未知");
      assert.equal((core.verdict.claims || []).length, 0);
    }

    const runtime = createRuntime({
      env: { ELECTRONICS_HARNESS_STUB: "" },
      harnessAvailable: true,
      router,
      officialRunAgent: async (job) => {
        assert.equal(job.kind, "part");
        assert.equal(job.input.mpn, row.mpn);
        return {
          ok: true,
          mpn: row.mpn,
          evidence: row.bogus ? [] : core.evidence,
          verdict: row.bogus || !core.evidence?.length
            ? { state: "未知", confidence: "low", claims: [] }
            : core.verdict,
          recommendation: core.recommendation,
          dossier: core.dossier,
          supply: core.supply,
          cards: core.cards,
          toolsCalled: ["part_research"],
        };
      },
    });
    const chat = await runtime.runChat({ message: `分析 ${row.mpn}`, mode: "agent" });
    const agent = parseAgentResponse(chat);
    assert.equal(agent.ok, true, JSON.stringify(agent.errors || chat));
    assert.equal(chat.skill, "part");
    assert.ok(chat.toolsCalled.includes("part_research"));
    assert.equal(chat.result.mpn, row.mpn);
    assert.match(chat.report.markdown, new RegExp(row.mpn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(chat.report.markdown, /# 型号分析报告/);
    if (row.bogus || chat.result.verdict.state === "未知") {
      assert.doesNotMatch(chat.report.markdown, /状态：热门|状态：缺货/);
      assert.match(chat.report.markdown, /证据不足|未知/);
    } else {
      assert.ok(chat.report.claimsCited.length >= 1);
    }
    passed += 1;
  }
  assert.ok(passed >= 5);
  assert.equal(passed, cases.length);
});

test("composer report template has required business sections", () => {
  const report = composePartReport({
    mpn: "STM32F103C8T6",
    identity: { mpn: "STM32F103C8T6", brand: "ST", category: "MCU", package: "LQFP-48" },
    evidence: [
      { id: "evi-l", sourceKey: "lcsc", title: "lcsc" },
      { id: "evi-h", sourceKey: "hqew", title: "hqew" },
    ],
    verdict: {
      state: "平稳",
      score: 40,
      confidence: "medium",
      claims: [{ text: "身份 ST MCU", evidenceId: "evi-l" }],
    },
    recommendation: { action: "人工确认后报价", reasoning: "工控入门" },
    dossier: { customers: "电控厂", extra: { notes: ["对 C8/CB"] } },
    supply: { offerCount: 3, lcscStock: 1200 },
    cards: {
      hot: { verdict: "有一定挂货，谈不上爆款", level: "mid" },
      supply: { verdict: "立创现货不多", level: "high" },
      price: { verdict: "还不能判断涨跌", level: "unknown", lcscPrice: 1.2, minPrice: 0.9 },
    },
    positioning: "ST 的MCU · LQFP-48",
  });
  for (const h of ["# 型号分析报告", "## 基础信息", "## 公开市场判断", "## 供应情况", "## 价格趋势", "## 内部业务判断", "## 综合建议"]) {
    assert.match(report.markdown, new RegExp(h));
  }
  assert.match(report.markdown, /evi-l/);
});
