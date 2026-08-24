export { extraKnowledge, buildDossier, computeMarketAnalysis } from "./knowledge.js";
export { analyzePart, buildMarketCards, partPositioning } from "./analyze.js";
export { researchPart } from "./research.js";
export { composePartReport, normalizePartResult } from "./compose.js";
export { extractMpn, inferPartIntent } from "./intent.js";
export {
  adviseFromContext,
  attachBusinessContextToPartResult,
  createContextAdviser,
  defaultAdviser,
  resolveBusinessContext,
} from "./context.js";
