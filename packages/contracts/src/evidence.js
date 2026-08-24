/**
 * evidence.ts — Claim { text, evidenceId } / EvidenceItem
 *
 * Lifted from Workbench VerdictSchema / EvidenceItemSchema.
 * Platform may hold temporary evidence; business systems persist official reports.
 */
import {
  CONFIDENCES,
  SOURCE_KEYS,
  bad,
  expectEnum,
  expectString,
  fail,
  isPlainObject,
  ok,
  rejectWriteSemantics,
} from "./common.js";

export const TRUST_LEVELS = Object.freeze(["high", "medium", "low"]);

export function parseClaim(input, path = "claim") {
  const errors = [];
  if (!isPlainObject(input)) {
    fail(errors, path, "expected object");
    return bad(errors);
  }
  rejectWriteSemantics(errors, path, input);
  expectString(errors, `${path}.text`, input.text, { max: 600 });
  expectString(errors, `${path}.evidenceId`, input.evidenceId, { max: 64 });
  if (errors.length) return bad(errors);
  return ok({
    text: String(input.text).trim(),
    evidenceId: String(input.evidenceId).trim(),
  });
}

export function parseEvidenceItem(input, path = "evidence") {
  const errors = [];
  if (!isPlainObject(input)) {
    fail(errors, path, "expected object");
    return bad(errors);
  }
  rejectWriteSemantics(errors, path, input);
  expectString(errors, `${path}.id`, input.id, { max: 64 });
  expectEnum(errors, `${path}.sourceKey`, input.sourceKey, SOURCE_KEYS);
  if (input.trust != null) expectEnum(errors, `${path}.trust`, input.trust, TRUST_LEVELS);
  if (input.url != null) expectString(errors, `${path}.url`, input.url, { allowEmpty: true, max: 500 });
  if (input.title != null) expectString(errors, `${path}.title`, input.title, { allowEmpty: true, max: 200 });
  if (input.capturedAt != null) expectString(errors, `${path}.capturedAt`, input.capturedAt, { max: 40 });
  if (input.mpn != null) expectString(errors, `${path}.mpn`, input.mpn, { allowEmpty: true, max: 80 });
  if (input.fields != null && !isPlainObject(input.fields)) {
    fail(errors, `${path}.fields`, "expected object");
  }
  if (errors.length) return bad(errors);
  return ok({
    id: String(input.id).trim(),
    sourceKey: input.sourceKey,
    trust: input.trust ?? "medium",
    url: input.url ? String(input.url) : "",
    title: input.title ? String(input.title) : "",
    capturedAt: input.capturedAt ? String(input.capturedAt) : null,
    mpn: input.mpn ? String(input.mpn) : "",
    fields: isPlainObject(input.fields) ? input.fields : {},
  });
}

export function parseVerdict(input, path = "verdict") {
  const errors = [];
  if (!isPlainObject(input)) {
    fail(errors, path, "expected object");
    return bad(errors);
  }
  rejectWriteSemantics(errors, path, input);
  expectString(errors, `${path}.state`, input.state, { max: 30 });
  if (input.score != null) {
    const n = Number(input.score);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      fail(errors, `${path}.score`, "expected 0-100");
    }
  }
  expectEnum(errors, `${path}.confidence`, input.confidence, CONFIDENCES);
  const claims = [];
  if (input.claims != null) {
    if (!Array.isArray(input.claims)) {
      fail(errors, `${path}.claims`, "expected array");
    } else {
      input.claims.forEach((c, i) => {
        const parsed = parseClaim(c, `${path}.claims[${i}]`);
        if (!parsed.ok) errors.push(...parsed.errors);
        else claims.push(parsed.value);
      });
    }
  }
  const state = String(input.state ?? "").trim();
  if (state && state !== "未知" && claims.length === 0) {
    fail(errors, `${path}.claims`, "non-unknown verdict requires at least one claim with evidenceId");
  }
  if (errors.length) return bad(errors);
  return ok({
    state,
    score: input.score == null ? null : Number(input.score),
    confidence: input.confidence,
    claims,
  });
}

export function evidenceIdsExist(claims, evidenceItems) {
  const have = new Set((evidenceItems ?? []).map((e) => e.id));
  return (claims ?? []).every((c) => have.has(c.evidenceId));
}
