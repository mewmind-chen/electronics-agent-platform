/**
 * part.ts — PartResearchRequest / PartResearchResult
 *
 * Identity / offer / intel fields come from Workbench result-types.ts.
 * Verdict / recommendation come from part-intelligence Skill.
 * No INSERT / report.save semantics.
 */
import {
  CURRENCIES,
  SOURCE_KEYS,
  assertMpnUnchanged,
  bad,
  displayMpn,
  expectEnum,
  expectNullOrNumber,
  expectString,
  fail,
  isPlainObject,
  ok,
  parseExecutionMode,
  rejectWriteSemantics,
} from "./common.js";
import { evidenceIdsExist, parseEvidenceItem, parseVerdict } from "./evidence.js";

export const PART_SOURCE_STEPS = Object.freeze([
  "lcsc",
  "st",
  "hqew",
  "intel",
  "findchips",
  "icnet",
]);

export function parsePartResearchRequest(input, path = "partRequest") {
  const errors = [];
  if (!isPlainObject(input)) {
    fail(errors, path, "expected object");
    return bad(errors);
  }
  rejectWriteSemantics(errors, path, input);
  expectString(errors, `${path}.mpn`, input.mpn, { max: 80 });
  if (input.steps != null) {
    if (!Array.isArray(input.steps)) fail(errors, `${path}.steps`, "expected array");
    else {
      input.steps.forEach((s, i) => expectEnum(errors, `${path}.steps[${i}]`, s, PART_SOURCE_STEPS));
    }
  }
  const mode = parseExecutionMode(input, path, errors);
  if (errors.length) return bad(errors);
  return ok({
    mpn: displayMpn(input.mpn),
    goal: input.goal ? String(input.goal) : "",
    holderQty: input.holderQty ?? undefined,
    cost: input.cost ?? undefined,
    steps: input.steps ?? ["lcsc", "hqew", "intel", "findchips", "icnet"],
    mode,
  });
}

function parseOffer(input, path) {
  const errors = [];
  if (!isPlainObject(input)) {
    fail(errors, path, "expected object");
    return bad(errors);
  }
  expectEnum(errors, `${path}.sourceKey`, input.sourceKey, SOURCE_KEYS);
  expectString(errors, `${path}.model`, input.model ?? input.mpn ?? "", { max: 80 });
  expectNullOrNumber(errors, `${path}.stock`, input.stock);
  expectNullOrNumber(errors, `${path}.price`, input.price);
  if (input.currency != null) expectEnum(errors, `${path}.currency`, input.currency, CURRENCIES);
  if (errors.length) return bad(errors);
  return ok({
    sourceKey: input.sourceKey,
    sourceName: input.sourceName ? String(input.sourceName) : input.sourceKey,
    supplier: input.supplier ? String(input.supplier) : "",
    model: displayMpn(input.model ?? input.mpn),
    brand: input.brand ? String(input.brand) : "",
    batch: input.batch ? String(input.batch) : "",
    stock: input.stock ?? null,
    price: input.price ?? null,
    priceBreaks: Array.isArray(input.priceBreaks) ? input.priceBreaks : [],
    package: input.package ? String(input.package) : "",
    warehouse: input.warehouse ? String(input.warehouse) : "",
    note: input.note ? String(input.note) : "",
    date: input.date ? String(input.date) : "",
    url: input.url ? String(input.url) : "",
    currency: input.currency ?? undefined,
  });
}

export function parsePartResearchResult(input, path = "partResult") {
  const errors = [];
  if (!isPlainObject(input)) {
    fail(errors, path, "expected object");
    return bad(errors);
  }
  rejectWriteSemantics(errors, path, input);
  expectString(errors, `${path}.mpn`, input.mpn, { max: 80 });
  if (input.mpnRaw != null) assertMpnUnchanged(errors, `${path}.mpn`, input.mpnRaw, input.mpn);
  const identity = isPlainObject(input.identity) ? input.identity : null;
  if (identity?.mpn) assertMpnUnchanged(errors, `${path}.identity.mpn`, input.mpn, identity.mpn);

  const offers = [];
  if (input.offers != null) {
    if (!Array.isArray(input.offers)) fail(errors, `${path}.offers`, "expected array");
    else {
      input.offers.forEach((o, i) => {
        const parsed = parseOffer(o, `${path}.offers[${i}]`);
        if (!parsed.ok) errors.push(...parsed.errors);
        else offers.push(parsed.value);
      });
    }
  }

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

  let verdict = null;
  if (input.verdict != null) {
    const parsed = parseVerdict(input.verdict, `${path}.verdict`);
    if (!parsed.ok) errors.push(...parsed.errors);
    else {
      verdict = parsed.value;
      if (!evidenceIdsExist(verdict.claims, evidence)) {
        fail(errors, `${path}.verdict.claims`, "every claim.evidenceId must exist in evidence[]");
      }
    }
  }

  if (input.recommendation != null) {
    if (!isPlainObject(input.recommendation)) {
      fail(errors, `${path}.recommendation`, "expected object");
    } else {
      rejectWriteSemantics(errors, `${path}.recommendation`, input.recommendation);
    }
  }

  if (errors.length) return bad(errors);
  return ok({
    mpn: displayMpn(input.mpn),
    identity: identity
      ? {
          mpn: displayMpn(identity.mpn || input.mpn),
          brand: identity.brand ?? "",
          category: identity.category ?? "",
          package: identity.package ?? "",
          desc: identity.desc ?? "",
          summary: identity.summary ?? "",
          features: identity.features ?? "",
          lcscCode: identity.lcscCode ?? "",
          specs: Array.isArray(identity.specs) ? identity.specs : [],
          applications: Array.isArray(identity.applications) ? identity.applications : [],
          longevity: identity.longevity ?? "",
          active: Boolean(identity.active),
          lcscStock: identity.lcscStock ?? null,
          priceBreaks: Array.isArray(identity.priceBreaks) ? identity.priceBreaks : [],
          lcscUrl: identity.lcscUrl ?? "",
          stUrl: identity.stUrl ?? "",
          imageUrl: identity.imageUrl ?? "",
        }
      : null,
    offers,
    evidence,
    verdict,
    recommendation: input.recommendation ?? null,
  });
}
