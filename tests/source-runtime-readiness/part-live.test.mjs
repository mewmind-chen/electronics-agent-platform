import test from "node:test";
import assert from "node:assert/strict";

const enabled = process.env.RUN_SOURCE_LIVE === "1" && process.env.AGENT_API_URL && process.env.ELECTRONICS_AGENT_PLATFORM_TOKEN;

test("live TPS54560DDAR source trace (conditional)", { skip: !enabled }, async () => {
  const response = await fetch(`${process.env.AGENT_API_URL.replace(/\/+$/, "")}/v1/parts/research`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.ELECTRONICS_AGENT_PLATFORM_TOKEN}`,
    },
    body: JSON.stringify({ mpn: "TPS54560DDAR", steps: ["lcsc", "hqew", "intel", "findchips", "icnet"], mode: "core" }),
  });
  assert.equal(response.ok, true);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.mpn, "TPS54560DDAR");
  assert.deepEqual(body.sourceRuntime.traces.map((trace) => trace.source), ["lcsc", "hqew", "intel", "findchips", "icnet"]);
  assert.ok(body.sourceRuntime.traces.every((trace) => ["OK", "EMPTY", "AUTH_REQUIRED", "DEGRADED", "ERROR"].includes(trace.status)));
});
