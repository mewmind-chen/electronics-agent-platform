# Phase 9 — Agent Architecture Contract + Part Intelligence Agent MVP

Radar / Workbench unchanged. No Supervisor. No Multi-Agent. No new models.

## 9.0 Frozen contract

- `packages/contracts/src/agent.js`
  - Agent Request / Response
  - Skill SOP headings: Goal / Tools / Steps / Evidence / Answer / Hard rules
  - Tool boundary
  - Evidence rules
  - Composer rules
- Official SOP: `.dsh/skills/part.md`

## 9.1 Closed loop

```
POST /v1/chat { message: "分析 TPS54560DDAR" }
→ inferPartIntent (deterministic)
→ Electronics Part Agent persona
→ official DeepSeekHarness.run + skill part
→ part_research Tool
→ part-intelligence-core + market-sources
→ PartResearchResult + Evidence
→ composePartReport (deterministic markdown)
```

Agent never writes Radar / Workbench databases.

## Live

`scripts/live-part-agent.mjs` → `tests/phase9/live-chat.json`

- message: `分析 TPS54560DDAR`
- viaHarness: true
- skill: part
- tool: `part_research`
- model: opencode-go / deepseek-v4-pro
- report composed; MPN unchanged
- this run had thin market evidence → `state=未知`, no invented claims
