/**
 * task.ts — TaskHandle / TaskEvent / TaskStatus
 *
 * Long research jobs (part / company) go through tasks.
 * Import extract is usually synchronous and does not need a task.
 */
import {
  bad,
  expectEnum,
  expectString,
  fail,
  isPlainObject,
  ok,
  rejectWriteSemantics,
} from "./common.js";

export const TASK_TYPES = Object.freeze(["part_research", "company_research"]);
export const TASK_STATUSES = Object.freeze(["queued", "running", "done", "failed", "cancelled"]);
export const TASK_EVENT_PHASES = Object.freeze([
  "tool_call",
  "observation",
  "decision",
  "error",
  "degrade",
]);

export function parseTaskCreateRequest(input, path = "taskCreate") {
  const errors = [];
  if (!isPlainObject(input)) {
    fail(errors, path, "expected object");
    return bad(errors);
  }
  rejectWriteSemantics(errors, path, input);
  expectEnum(errors, `${path}.type`, input.type, TASK_TYPES);
  if (input.input != null && !isPlainObject(input.input)) {
    fail(errors, `${path}.input`, "expected object");
  }
  const payload = isPlainObject(input.input) ? input.input : {};
  if (input.type === "part_research") {
    expectString(errors, `${path}.input.mpn`, payload.mpn, { max: 80 });
  }
  if (input.type === "company_research") {
    expectString(errors, `${path}.input.company`, payload.company, { max: 80 });
  }
  if (errors.length) return bad(errors);
  return ok({
    type: input.type,
    input: {
      mpn: payload.mpn ? String(payload.mpn).trim() : undefined,
      company: payload.company ? String(payload.company).trim() : undefined,
      goal: payload.goal ? String(payload.goal).trim() : "",
      holderQty: payload.holderQty ?? undefined,
      cost: payload.cost ?? undefined,
    },
  });
}

export function parseTaskHandle(input, path = "task") {
  const errors = [];
  if (!isPlainObject(input)) {
    fail(errors, path, "expected object");
    return bad(errors);
  }
  rejectWriteSemantics(errors, path, input);
  expectString(errors, `${path}.taskId`, input.taskId, { max: 64 });
  expectEnum(errors, `${path}.type`, input.type, TASK_TYPES);
  expectEnum(errors, `${path}.status`, input.status, TASK_STATUSES);
  if (errors.length) return bad(errors);
  return ok({
    taskId: String(input.taskId).trim(),
    type: input.type,
    status: input.status,
  });
}

export function parseTaskEvent(input, path = "event") {
  const errors = [];
  if (!isPlainObject(input)) {
    fail(errors, path, "expected object");
    return bad(errors);
  }
  rejectWriteSemantics(errors, path, input);
  expectString(errors, `${path}.taskId`, input.taskId, { max: 64 });
  expectEnum(errors, `${path}.phase`, input.phase, TASK_EVENT_PHASES);
  if (input.name != null) expectString(errors, `${path}.name`, input.name, { allowEmpty: true, max: 80 });
  if (input.payload != null && !isPlainObject(input.payload)) {
    fail(errors, `${path}.payload`, "expected object");
  }
  if (errors.length) return bad(errors);
  return ok({
    taskId: String(input.taskId).trim(),
    phase: input.phase,
    name: input.name ? String(input.name) : "",
    payload: isPlainObject(input.payload) ? input.payload : {},
  });
}
