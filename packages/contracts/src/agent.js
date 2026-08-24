/**
 * Phase 9.0 Agent Architecture Contract.
 * Natural-language Agent Request/Response. No Harness types. No SQL.
 */
import {
  bad,
  expectEnum,
  expectString,
  fail,
  isPlainObject,
  ok,
  parseExecutionMode,
  parseModelSelection,
  rejectWriteSemantics,
} from "./common.js";
import { parsePartResearchResult } from "./part.js";

export const AGENT_INTENTS = Object.freeze(["part_research", "unsupported"]);
export const AGENT_SKILLS = Object.freeze(["part", "import", "company", "hello"]);
export const AGENT_TOOLS = Object.freeze({
  part: Object.freeze(["part_research"]),
  import: Object.freeze([
    "import_classify",
    "import_table_preview",
    "import_validate_mapping",
    "import_apply_mapping",
    "import_normalize_text",
    "import_validate_rows",
  ]),
  company: Object.freeze(["company_research"]),
  hello: Object.freeze(["hello_ping"]),
});

/** Frozen Skill SOP headings. Official .dsh/skills/*.md must include these. */
export const SKILL_SOP_SECTIONS = Object.freeze([
  "Goal",
  "Tools",
  "Steps",
  "Evidence",
  "Answer",
  "Hard rules",
]);

export const TOOL_BOUNDARY = Object.freeze({
  may: Object.freeze(["call core", "return contracts", "return evidence items"]),
  mustNot: Object.freeze([
    "write Radar or Workbench databases",
    "INSERT / confirmImport / saveReport",
    "treat source failure as evidence",
    "invent claims without evidenceId",
    "autocomplete or rewrite MPN",
  ]),
});

export const EVIDENCE_RULES = Object.freeze({
  claimRequiresEvidenceId: true,
  evidenceIdMustExist: true,
  sourceFailureIsNotEvidence: true,
  unknownIfNoEvidence: true,
  composerCannotAddClaims: true,
});

export const COMPOSER_RULES = Object.freeze({
  input: "validated domain result (PartResearchResult)",
  output: "markdown report + cited evidenceIds",
  onlyCiteExistingClaims: true,
  copyMpnVerbatim: true,
  unknownMeansInsufficientEvidence: true,
});

export function validateSkillSop(markdown, path = "skill") {
  const errors = [];
  const text = String(markdown || "");
  if (!text.includes("name:")) fail(errors, `${path}.frontmatter`, "missing name");
  for (const section of SKILL_SOP_SECTIONS) {
    const hit = new RegExp(`^#{1,3}\\s+${section}\\s*$`, "im").test(text);
    if (!hit) fail(errors, `${path}.${section}`, `missing heading ${section}`);
  }
  if (!/never write|不得写库|do not write/i.test(text)) {
    fail(errors, `${path}.Hard rules`, "must forbid writing a business database");
  }
  if (errors.length) return bad(errors);
  return ok({ sections: SKILL_SOP_SECTIONS.slice() });
}

export function parseAgentRequest(input, path = "agentRequest") {
  const errors = [];
  if (!isPlainObject(input)) {
    fail(errors, path, "expected object");
    return bad(errors);
  }
  rejectWriteSemantics(errors, path, input);
  expectString(errors, `${path}.message`, input.message, { max: 2000 });
  if (input.skill != null) expectEnum(errors, `${path}.skill`, input.skill, AGENT_SKILLS);
  if (input.context != null && !isPlainObject(input.context)) {
    fail(errors, `${path}.context`, "expected object");
  }
  const mode = parseExecutionMode(input, path, errors);
  const model = parseModelSelection(input, path, errors);
  if (errors.length) return bad(errors);
  return ok({
    message: String(input.message).trim(),
    skill: input.skill || undefined,
    context: isPlainObject(input.context) ? input.context : {},
    mode,
    ...model,
  });
}

export function parseAgentIntent(input, path = "intent") {
  const errors = [];
  if (!isPlainObject(input)) {
    fail(errors, path, "expected object");
    return bad(errors);
  }
  expectEnum(errors, `${path}.kind`, input.kind, AGENT_INTENTS);
  if (input.kind === "part_research") {
    expectString(errors, `${path}.mpn`, input.mpn, { max: 80 });
    expectEnum(errors, `${path}.skill`, input.skill || "part", AGENT_SKILLS);
  }
  if (errors.length) return bad(errors);
  return ok({
    kind: input.kind,
    skill: input.kind === "part_research" ? "part" : input.skill || null,
    mpn: input.mpn ? String(input.mpn).trim() : undefined,
    reason: input.reason ? String(input.reason) : "",
  });
}

export function parseAgentReport(input, path = "report") {
  const errors = [];
  if (!isPlainObject(input)) {
    fail(errors, path, "expected object");
    return bad(errors);
  }
  rejectWriteSemantics(errors, path, input);
  expectString(errors, `${path}.markdown`, input.markdown, { max: 12000 });
  const claimsCited = [];
  if (input.claimsCited != null) {
    if (!Array.isArray(input.claimsCited)) fail(errors, `${path}.claimsCited`, "expected array");
    else {
      input.claimsCited.forEach((id, i) => {
        expectString(errors, `${path}.claimsCited[${i}]`, id, { max: 64 });
        if (id) claimsCited.push(String(id));
      });
    }
  }
  if (errors.length) return bad(errors);
  return ok({
    markdown: String(input.markdown),
    claimsCited,
  });
}

export function parseAgentResponse(input, path = "agentResponse") {
  const errors = [];
  if (!isPlainObject(input)) {
    fail(errors, path, "expected object");
    return bad(errors);
  }
  rejectWriteSemantics(errors, path, input);
  if (input.ok !== true && input.ok !== false) {
    fail(errors, `${path}.ok`, "expected boolean");
  }
  let intent = null;
  if (input.intent != null) {
    const parsed = parseAgentIntent(input.intent, `${path}.intent`);
    if (!parsed.ok) errors.push(...parsed.errors);
    else intent = parsed.value;
  }
  let report = null;
  if (input.report != null) {
    const parsed = parseAgentReport(input.report, `${path}.report`);
    if (!parsed.ok) errors.push(...parsed.errors);
    else report = parsed.value;
  }
  let result = null;
  if (input.result != null) {
    const parsed = parsePartResearchResult(input.result, `${path}.result`);
    if (!parsed.ok) errors.push(...parsed.errors);
    else result = parsed.value;
  }
  if (input.ok === true && intent?.kind === "part_research" && !result) {
    fail(errors, `${path}.result`, "successful part agent must include PartResearchResult");
  }
  if (input.ok === true && intent?.kind === "part_research" && !report) {
    fail(errors, `${path}.report`, "successful part agent must include composed report");
  }
  if (errors.length) return bad(errors);
  return ok({
    ok: Boolean(input.ok),
    intent,
    skill: input.skill || intent?.skill || null,
    toolsCalled: Array.isArray(input.toolsCalled) ? input.toolsCalled.map(String) : [],
    result,
    report,
    viaHarness: Boolean(input.viaHarness),
    usedAi: Boolean(input.usedAi),
    route: input.route || null,
    mode: input.mode || "auto",
    modelRoute: input.modelRoute || null,
    error: input.error || undefined,
    reason: input.reason || undefined,
    premiumReviewUnavailable: Boolean(input.premiumReviewUnavailable),
  });
}
