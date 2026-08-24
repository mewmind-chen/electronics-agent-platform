/**
 * Phase 9.3 Business Context Contract.
 * External market evidence and internal business context stay separate.
 * No DB access. No Harness types. Caller injects snapshots on the request.
 */
import {
  bad,
  expectEnum,
  expectNullOrNumber,
  fail,
  isPlainObject,
  ok,
  rejectWriteSemantics,
} from "./common.js";

export const CONTEXT_ORIGINS = Object.freeze(["radar", "workbench", "caller"]);
export const CONTEXT_KINDS = Object.freeze(["market", "inventory", "quotation", "customer"]);

export const CONTEXT_RULES = Object.freeze({
  externalEvidenceRequiresEvidenceId: true,
  internalContextMustTagSource: true,
  internalContextIsNotEvidence: true,
  agentMustNotReadBusinessDb: true,
  customerReserved: true,
});

function originOf(input, fallback = "caller") {
  const raw = input?.source || input?.origin || fallback;
  return CONTEXT_ORIGINS.includes(raw) ? raw : fallback;
}

export function parseInventoryContext(input, path = "context.inventory") {
  if (input == null) return ok(null);
  const errors = [];
  if (!isPlainObject(input)) {
    fail(errors, path, "expected object");
    return bad(errors);
  }
  rejectWriteSemantics(errors, path, input);
  if (input.onHand != null) expectNullOrNumber(errors, `${path}.onHand`, input.onHand);
  if (input.inTransit != null) expectNullOrNumber(errors, `${path}.inTransit`, input.inTransit);
  if (errors.length) return bad(errors);
  return ok({
    kind: "inventory",
    origin: originOf(input, "radar"),
    onHand: input.onHand ?? null,
    inTransit: input.inTransit ?? null,
    warehouse: input.warehouse ? String(input.warehouse) : "",
  });
}

export function parseQuotationContext(input, path = "context.quotation") {
  if (input == null) return ok(null);
  const errors = [];
  if (!isPlainObject(input)) {
    fail(errors, path, "expected object");
    return bad(errors);
  }
  rejectWriteSemantics(errors, path, input);
  if (input.openCount != null) expectNullOrNumber(errors, `${path}.openCount`, input.openCount);
  if (input.recentCount != null) expectNullOrNumber(errors, `${path}.recentCount`, input.recentCount);
  if (errors.length) return bad(errors);
  return ok({
    kind: "quotation",
    origin: originOf(input, "workbench"),
    openCount: input.openCount ?? input.internalQuoteCount ?? 0,
    recentCount: input.recentCount ?? null,
    lastQuotedAt: input.lastQuotedAt ? String(input.lastQuotedAt) : "",
  });
}

export function parseCustomerContext(input, path = "context.customer") {
  if (input == null) return ok(null);
  const errors = [];
  if (!isPlainObject(input)) {
    fail(errors, path, "expected object");
    return bad(errors);
  }
  rejectWriteSemantics(errors, path, input);
  if (errors.length) return bad(errors);
  return ok({
    kind: "customer",
    origin: originOf(input, "caller"),
    reserved: true,
    note: input.note ? String(input.note) : "",
  });
}

export function parseBusinessContext(input, path = "context") {
  const errors = [];
  const raw = isPlainObject(input) ? input : {};
  if (input != null && !isPlainObject(input)) {
    fail(errors, path, "expected object");
    return bad(errors);
  }
  rejectWriteSemantics(errors, path, raw);
  if (raw.kind != null) expectEnum(errors, `${path}.kind`, raw.kind, CONTEXT_KINDS);

  const inventory = parseInventoryContext(raw.inventory, `${path}.inventory`);
  const quotation = parseQuotationContext(raw.quotation || (raw.internalQuoteCount != null ? { openCount: raw.internalQuoteCount, source: "caller" } : null), `${path}.quotation`);
  const customer = parseCustomerContext(raw.customer, `${path}.customer`);
  if (!inventory.ok) errors.push(...inventory.errors);
  if (!quotation.ok) errors.push(...quotation.errors);
  if (!customer.ok) errors.push(...customer.errors);
  if (errors.length) return bad(errors);

  const internals = [inventory.value, quotation.value, customer.value].filter(Boolean);
  return ok({
    market: raw.market && isPlainObject(raw.market) ? { kind: "market", origin: "market-sources", note: "filled by Part Core, not caller DB" } : null,
    inventory: inventory.value,
    quotation: quotation.value,
    customer: customer.value,
    internals,
    internalQuoteCount: quotation.value?.openCount || 0,
    snapshots: Array.isArray(raw.snapshots) ? raw.snapshots : [],
    previousLcscPrice: raw.previousLcscPrice ?? null,
  });
}

export function isInternalContextItem(item) {
  return Boolean(item && CONTEXT_KINDS.includes(item.kind) && item.kind !== "market" && CONTEXT_ORIGINS.includes(item.origin));
}
