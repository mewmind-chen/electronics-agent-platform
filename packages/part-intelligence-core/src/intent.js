/**
 * Natural-language intent for Phase 9 Part Agent.
 * Deterministic. Does not call a model. Does not invent an MPN.
 */
const MPN_TOKEN = /\b[A-Za-z][A-Za-z0-9+._\/-]{3,39}\b/g;
const PART_CUES = /分析|研究|查一下|看看|调研|型号|mpn|analyze|research|look\s*up/i;

function looksLikeMpn(token) {
  const t = String(token || "").trim();
  if (t.length < 5 || t.length > 40) return false;
  if (!/[A-Za-z]/.test(t) || !/\d/.test(t)) return false;
  if (/^(http|https|analyze|research)$/i.test(t)) return false;
  return true;
}

export function extractMpn(message) {
  const text = String(message || "");
  const hits = text.match(MPN_TOKEN) || [];
  const mpns = hits.filter(looksLikeMpn);
  if (!mpns.length) return "";
  return mpns.sort((a, b) => b.length - a.length)[0];
}

export function inferPartIntent(message) {
  const mpn = extractMpn(message);
  if (mpn && (PART_CUES.test(message) || looksLikeMpn(message.trim()))) {
    return {
      kind: "part_research",
      skill: "part",
      mpn,
      reason: "natural-language part research",
    };
  }
  return {
    kind: "unsupported",
    skill: null,
    reason: mpn ? "message is not a part-research request" : "no MPN in message",
  };
}
