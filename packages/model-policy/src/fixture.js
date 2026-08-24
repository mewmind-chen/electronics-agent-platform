/** Test-only production projection. Never used as a live default. */
import { MODEL_CANDIDATES, applyQualification } from "./registry.js";
import { providerBindings } from "./binding.js";

const PASS = Object.freeze({
  json: "pass",
  toolCalling: "pass",
  structuredLong: "pass",
  harness: "pass",
  vision: "n/a",
});

export function productionFixture(ids) {
  const live = MODEL_CANDIDATES.filter((m) => !ids || ids.includes(m.id)).map((m) => ({
    id: m.id,
    providerId: m.provider,
    verified: true,
    availability: "bound",
    health: "up",
    capabilities: m.roles.includes("vision") ? { ...PASS, vision: "pass" } : PASS,
  }));
  return applyQualification(MODEL_CANDIDATES, live, providerBindings());
}
