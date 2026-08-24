/**
 * Result-driven escalation. Callers must not need to pre-set lowConfidence.
 */
const IMPORT_ESCALATE_CODES = new Set(["qty_conflict", "mpn_provenance"]);

export function researchNeedsPremium(result) {
  if (!result || result.ok === false) return false;
  const confidence = result.verdict?.confidence;
  if (confidence === "low") return true;
  const claims = result.verdict?.claims || [];
  const evidence = result.evidence || [];
  const ids = new Set(evidence.map((e) => e.id));
  if (claims.some((c) => c.evidenceId && !ids.has(c.evidenceId))) return true;
  const trusts = evidence.map((e) => e.trust).filter(Boolean);
  if (trusts.includes("high") && trusts.includes("low")) return true;
  if (result.conflictingEvidence === true) return true;
  return false;
}

export function importNeedsReasoning(result) {
  if (!result) return false;
  const rows = result.candidates || [];
  return rows.some((row) =>
    (row.warnings || []).some((w) => IMPORT_ESCALATE_CODES.has(w.code)),
  );
}

export function nextEscalationRole(kind, result, currentRole) {
  if (kind === "import") {
    if (currentRole === "fast" && importNeedsReasoning(result)) return "reasoning";
    return null;
  }
  if ((kind === "part" || kind === "company") && currentRole !== "premium" && researchNeedsPremium(result)) {
    return "premium";
  }
  return null;
}
