/**
 * Task → role. Deterministic. No model names here.
 */
export function inferRole(task = {}) {
  if (task.role) return task.role;
  if (task.escalate || task.lowConfidence || task.conflictingEvidence) return "premium";
  if (task.kind === "part" || task.kind === "company") return "reasoning";
  if (task.kind === "import") {
    const sourceType = String(task.sourceType || "").toLowerCase();
    const mime = String(task.mime || "").toLowerCase();
    const name = String(task.filename || "").toLowerCase();
    if (sourceType === "image" || mime.startsWith("image/")) return "vision";
    if (sourceType === "pdf" || sourceType === "word" || mime.includes("pdf") || /\.(pdf|docx?)$/.test(name)) {
      return "long";
    }
    return "fast";
  }
  return "fast";
}

export function inferTaskFromInput(kind, input = {}) {
  return {
    kind,
    sourceType: input.sourceType,
    mime: input.mime,
    filename: input.filename,
    role: input.role,
    escalate: Boolean(input.escalate),
    lowConfidence: input.lowConfidence === true || input.confidence === "low",
    conflictingEvidence: Boolean(input.conflictingEvidence),
    quality: input.quality,
    modelMode: input.modelMode,
    provider: input.provider,
    model: input.model,
    sessionModel: input.sessionModel,
  };
}
