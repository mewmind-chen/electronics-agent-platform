#!/usr/bin/env node
/**
 * Deployment smoke: public readiness plus authenticated, real core research
 * using the two independently-owned Phase 9.4 Context shapes. It never makes
 * a model turn and never prints credentials or internal context values.
 */
const args = process.argv.slice(2);
function option(name, fallback = "") {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || "") : fallback;
}

const baseUrl = option("--url", process.env.AGENT_API_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const token = option("--token", process.env.AGENT_API_TOKEN || "").trim();
if (!token) {
  process.stderr.write("[deployment-smoke] AGENT_API_TOKEN or --token is required\n");
  process.exit(64);
}

async function readJson(res, label) {
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    throw new Error(`${label} failed with HTTP ${res.status}`);
  }
  return body;
}

const health = await readJson(await fetch(`${baseUrl}/health`), "health");
if (health.service !== "electronics-agent-api") throw new Error("unexpected health service");

const shapes = [
  {
    label: "radar-inventory-context",
    body: {
      mpn: "NE555P",
      mode: "core",
      steps: ["hqew"],
      context: { inventory: { source: "radar", onHand: 2, inTransit: 0, warehouse: "summary" } },
    },
  },
  {
    label: "workbench-quotation-context",
    body: {
      mpn: "NE555P",
      mode: "core",
      steps: ["hqew"],
      context: { quotation: { source: "workbench", openCount: 1, recentCount: 1, lastQuotedAt: "2026-08-24T00:00:00.000Z" } },
    },
  },
];

for (const shape of shapes) {
  const result = await readJson(
    await fetch(`${baseUrl}/v1/parts/research`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(shape.body),
    }),
    shape.label,
  );
  if (!result.businessContext || !result.advice) throw new Error(`${shape.label} did not preserve business context`);
}

process.stdout.write("deployment smoke passed: health + Radar/Workbench request contexts\n");
