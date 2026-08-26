import test from "node:test";
import assert from "node:assert/strict";

const enabled = process.env.RUN_SOURCE_LIVE === "1" && process.env.AGENT_API_URL && process.env.ELECTRONICS_AGENT_PLATFORM_TOKEN;

test("live TI company source trace (conditional)", { skip: !enabled }, async () => {
  const response = await fetch(`${process.env.AGENT_API_URL.replace(/\/+$/, "")}/v1/companies/research`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.ELECTRONICS_AGENT_PLATFORM_TOKEN}`,
    },
    body: JSON.stringify({ company: "Texas Instruments", steps: ["gys", "shop", "intel"], mode: "core" }),
  });
  assert.equal(response.ok, true);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.company, "Texas Instruments");
  assert.deepEqual(body.sourceRuntime.traces.map((trace) => trace.source), ["gys", "shop", "intel"]);
  assert.ok(body.sourceRuntime.traces.every((trace) => ["OK", "EMPTY", "AUTH_REQUIRED", "DEGRADED", "ERROR"].includes(trace.status)));
});
