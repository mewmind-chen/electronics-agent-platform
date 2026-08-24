import { postJson } from "../client.js";

export async function execute(args = {}) {
  const mpn = String(args.mpn || "").trim();
  if (!mpn) return { ok: false, error: "contract_error", reason: "mpn required" };
  const body = { mpn, mode: args.mode || "auto" };
  if (args.goal) body.goal = args.goal;
  if (args.steps) body.steps = args.steps;
  return postJson("/v1/parts/research", body);
}
