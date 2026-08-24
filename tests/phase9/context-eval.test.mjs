import test from "node:test";
import assert from "node:assert/strict";
import { researchPart, composePartReport } from "../../packages/part-intelligence-core/src/index.js";

test("same MPN with and without business context yields different advice", async () => {
  const mpn = "TPS54560DDAR";
  const bare = await researchPart({ mpn, steps: ["hqew"] }, {});
  const withCtx = await researchPart(
    {
      mpn,
      steps: ["hqew"],
      context: {
        inventory: { source: "radar", onHand: 8000, inTransit: 0 },
        quotation: { source: "workbench", openCount: 4 },
      },
    },
    {},
  );
  assert.equal(bare.ok, true);
  assert.equal(withCtx.ok, true);
  assert.equal(bare.mpn, mpn);
  assert.equal(withCtx.mpn, mpn);
  assert.equal(bare.advice.usedInternal, false);
  assert.equal(withCtx.advice.usedInternal, true);
  assert.notEqual(bare.recommendation.action, withCtx.recommendation.action);
  assert.match(withCtx.recommendation.action, /消化库存|询价/);

  const bareReport = composePartReport(bare);
  const ctxReport = composePartReport(withCtx);
  assert.match(bareReport.markdown, /内部上下文：未注入/);
  assert.match(ctxReport.markdown, /库存上下文（radar）/);
  assert.match(ctxReport.markdown, /询价上下文（workbench）/);
  assert.match(ctxReport.markdown, /不是公开 evidenceId/);
  assert.notEqual(bareReport.markdown, ctxReport.markdown);
  assert.equal(JSON.stringify(withCtx.evidence || []).includes("radar"), false);
});
