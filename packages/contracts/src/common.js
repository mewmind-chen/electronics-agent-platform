/**
 * Shared contract helpers. Zero runtime dependencies.
 * These types must stay free of @deepseek-ai / Harness imports.
 */

export const CONTRACT_VERSION = "0.2.1";
export const EXECUTION_MODES = Object.freeze(["auto", "agent", "core"]);

export const CURRENCIES = Object.freeze(["USD", "CNY"]);
export const COST_TAXES = Object.freeze(["none", "exclusive", "inclusive"]);
export const CONFIDENCES = Object.freeze(["high", "medium", "low"]);
export const SOURCE_KEYS = Object.freeze([
  "lcsc",
  "st",
  "hqew",
  "gys",
  "shop",
  "intel",
  "icnet",
  "findchips",
  "internal",
]);

const WRITE_KEYS = Object.freeze([
  "insert",
  "INSERT",
  "sql",
  "confirmImport",
  "writeDb",
  "writeDatabase",
]);

export function isPlainObject(v) {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

export function fail(errors, path, message) {
  errors.push({ path, message });
}

/** auto = default. viaAgent:true maps to agent for one-release compatibility. */
export function parseExecutionMode(input, path, errors) {
  if (!isPlainObject(input)) return "auto";
  if (input.mode != null) {
    expectEnum(errors, `${path}.mode`, input.mode, EXECUTION_MODES);
    return EXECUTION_MODES.includes(input.mode) ? input.mode : "auto";
  }
  if (input.viaAgent === true) return "agent";
  if (input.viaAgent === false) return "core";
  return "auto";
}

export function expectEnum(errors, path, value, allowed) {
  if (!allowed.includes(value)) {
    fail(errors, path, `expected one of ${allowed.join("|")}, got ${JSON.stringify(value)}`);
    return false;
  }
  return true;
}

export function expectString(errors, path, value, { allowEmpty = false, max = 2000 } = {}) {
  if (typeof value !== "string") {
    fail(errors, path, "expected string");
    return false;
  }
  if (!allowEmpty && !value.trim()) {
    fail(errors, path, "expected non-empty string");
    return false;
  }
  if (value.length > max) {
    fail(errors, path, `string longer than ${max}`);
    return false;
  }
  return true;
}

export function expectNullOrString(errors, path, value, opts) {
  if (value == null) return true;
  return expectString(errors, path, value, opts);
}

export function expectFiniteNumber(errors, path, value, { min, max, integer = false } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(errors, path, "expected finite number");
    return false;
  }
  if (integer && !Number.isInteger(value)) {
    fail(errors, path, "expected integer");
    return false;
  }
  if (min != null && value < min) {
    fail(errors, path, `expected >= ${min}`);
    return false;
  }
  if (max != null && value > max) {
    fail(errors, path, `expected <= ${max}`);
    return false;
  }
  return true;
}

export function expectNullOrNumber(errors, path, value, opts) {
  if (value == null) return true;
  return expectFiniteNumber(errors, path, value, opts);
}

export function rejectWriteSemantics(errors, path, value) {
  if (!isPlainObject(value) && typeof value !== "string") return;
  const blob = typeof value === "string" ? value : JSON.stringify(value);
  for (const key of WRITE_KEYS) {
    if (blob.includes(key)) {
      fail(errors, path, `write/SQL semantics are forbidden on Agent contracts (${key})`);
      return;
    }
  }
}

/** Display MPN: NFKC + trim only. Never rewrite characters. */
export function displayMpn(raw) {
  return String(raw ?? "").normalize("NFKC").trim();
}

export function normalizeMpnKey(raw) {
  return displayMpn(raw).toUpperCase();
}

/**
 * AI / Agent must not autocomplete or mutate MPN characters.
 * Only NFKC + trim is allowed. Anything else is a protocol violation.
 */
export function assertMpnUnchanged(errors, path, original, candidate) {
  const shown = displayMpn(original);
  const got = displayMpn(candidate);
  if (!got) {
    fail(errors, path, "mpn required");
    return false;
  }
  if (got !== shown) {
    fail(errors, path, "mpn must not be auto-completed or rewritten; only NFKC/trim allowed");
    return false;
  }
  return true;
}

export function ok(value) {
  return { ok: true, value, errors: [] };
}

export function bad(errors) {
  return { ok: false, value: null, errors };
}
