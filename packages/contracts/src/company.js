/**
 * company.ts — CompanyResearchRequest / CompanyResearchResult
 *
 * Profile chapters come from company-intelligence Skill.
 * CompanyCard / ShopRow come from Workbench md-parse.ts.
 */
import {
  bad,
  expectEnum,
  expectString,
  fail,
  isPlainObject,
  ok,
  parseExecutionMode,
  rejectWriteSemantics,
} from "./common.js";
import { evidenceIdsExist, parseEvidenceItem, parseVerdict } from "./evidence.js";

export const COMPANY_TYPES = Object.freeze(["贸易", "代理", "工厂", "unknown"]);
export const COMPANY_STEPS = Object.freeze(["gys", "shop", "intel"]);

export function parseCompanyResearchRequest(input, path = "companyRequest") {
  const errors = [];
  if (!isPlainObject(input)) {
    fail(errors, path, "expected object");
    return bad(errors);
  }
  rejectWriteSemantics(errors, path, input);
  expectString(errors, `${path}.company`, input.company, { max: 80 });
  if (input.steps != null) {
    if (!Array.isArray(input.steps)) fail(errors, `${path}.steps`, "expected array");
    else input.steps.forEach((s, i) => expectEnum(errors, `${path}.steps[${i}]`, s, COMPANY_STEPS));
  }
  const mode = parseExecutionMode(input, path, errors);
  if (errors.length) return bad(errors);
  return ok({
    company: String(input.company).trim(),
    goal: input.goal ? String(input.goal) : "",
    steps: input.steps ?? ["gys", "shop", "intel"],
    mode,
  });
}

export function parseCompanyResearchResult(input, path = "companyResult") {
  const errors = [];
  if (!isPlainObject(input)) {
    fail(errors, path, "expected object");
    return bad(errors);
  }
  rejectWriteSemantics(errors, path, input);
  expectString(errors, `${path}.company`, input.company, { max: 80 });

  const evidence = [];
  if (input.evidence != null) {
    if (!Array.isArray(input.evidence)) fail(errors, `${path}.evidence`, "expected array");
    else {
      input.evidence.forEach((e, i) => {
        const parsed = parseEvidenceItem(e, `${path}.evidence[${i}]`);
        if (!parsed.ok) errors.push(...parsed.errors);
        else evidence.push(parsed.value);
      });
    }
  }

  const profile = isPlainObject(input.profile) ? input.profile : {};
  if (profile.companyType != null) {
    expectEnum(errors, `${path}.profile.companyType`, profile.companyType, COMPANY_TYPES);
  }
  const branded = [];
  for (const [label, arr] of [
    ["mainBrands", profile.mainBrands],
    ["topMpns", profile.topMpns],
  ]) {
    if (arr == null) continue;
    if (!Array.isArray(arr)) {
      fail(errors, `${path}.profile.${label}`, "expected array");
      continue;
    }
    arr.forEach((row, i) => {
      if (!isPlainObject(row) || !row.evidenceId) {
        fail(errors, `${path}.profile.${label}[${i}]`, "expected {..., evidenceId}");
        return;
      }
      branded.push({ evidenceId: String(row.evidenceId) });
    });
  }

  let verdict = null;
  if (input.verdict != null) {
    const parsed = parseVerdict(input.verdict, `${path}.verdict`);
    if (!parsed.ok) errors.push(...parsed.errors);
    else {
      verdict = parsed.value;
      const allClaims = [...verdict.claims, ...branded];
      if (!evidenceIdsExist(allClaims, evidence)) {
        fail(errors, `${path}.profile`, "brand/mpn/claim evidenceId must exist in evidence[]");
      }
    }
  } else if (branded.length && !evidenceIdsExist(branded, evidence)) {
    fail(errors, `${path}.profile`, "brand/mpn evidenceId must exist in evidence[]");
  }

  if (input.recommendation != null) {
    if (!isPlainObject(input.recommendation)) fail(errors, `${path}.recommendation`, "expected object");
    else rejectWriteSemantics(errors, `${path}.recommendation`, input.recommendation);
  }

  if (errors.length) return bad(errors);
  return ok({
    company: String(input.company).trim(),
    profile: {
      identity: {
        name: profile.identity?.name ? String(profile.identity.name) : String(input.company).trim(),
        aliases: Array.isArray(profile.identity?.aliases) ? profile.identity.aliases : [],
        companyType: profile.companyType ?? profile.identity?.companyType ?? "unknown",
      },
      mainBrands: Array.isArray(profile.mainBrands) ? profile.mainBrands : [],
      topMpns: Array.isArray(profile.topMpns) ? profile.topMpns : [],
      stockStructure: isPlainObject(profile.stockStructure) ? profile.stockStructure : {},
      supplyRoute: isPlainObject(profile.supplyRoute) ? profile.supplyRoute : {},
      fitForUs: isPlainObject(profile.fitForUs) ? profile.fitForUs : {},
    },
    companies: Array.isArray(input.companies) ? input.companies : [],
    shopRows: Array.isArray(input.shopRows) ? input.shopRows : [],
    evidence,
    verdict,
    recommendation: input.recommendation ?? null,
  });
}
