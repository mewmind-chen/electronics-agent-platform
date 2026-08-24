import { postJson } from "../client.js";

export async function execute(args = {}) {
  const company = String(args.company || "").trim();
  if (!company) return { ok: false, error: "contract_error", reason: "company required" };
  const body = { company, mode: args.mode || "auto" };
  if (args.goal) body.goal = args.goal;
  if (args.steps) body.steps = args.steps;
  return postJson("/v1/companies/research", body);
}
