/**
 * Research/task helpers. Business routes go through AgentRuntime.
 * Credentials are request-scoped. Results are not persisted here.
 */

export function requestCtx(req, extra = {}) {
  const context = extra.context && typeof extra.context === "object" ? extra.context : {};
  return {
    firecrawlKey: extra.firecrawlKey || req.headers["x-firecrawl-key"] || process.env.FIRECRAWL_API_KEY || "",
    anysearchKey: extra.anysearchKey || process.env.ANYSEARCH_API_KEY || "",
    icnetCookie: extra.icnetCookie || process.env.ICNET_COOKIE || "",
    mouserKey: extra.mouserKey || process.env.MOUSER_API_KEY || "",
    inventory: context.inventory || extra.inventory,
    quotation: context.quotation || extra.quotation,
    customer: context.customer || extra.customer,
    internalQuoteCount: extra.internalQuoteCount ?? context.quotation?.openCount ?? 0,
    snapshots: extra.snapshots ?? context.snapshots ?? [],
    previousLcscPrice: extra.previousLcscPrice ?? context.previousLcscPrice ?? null,
    signal: extra.signal,
  };
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function createResearchHandlers(runtime, {
  store,
  deadlineMs = positiveInteger(process.env.TASK_DEADLINE_MS, 120_000),
  maxConcurrent = positiveInteger(process.env.TASK_MAX_CONCURRENT, 4),
  maxQueued = positiveInteger(process.env.TASK_MAX_QUEUED, 20),
} = {}) {
  if (!store) throw new Error("createResearchHandlers requires a durable TaskStore");
  const taskInputs = new Map();
  const controllers = new Map();
  const pendingRuns = new Map();
  const executions = new Map();
  let accepting = true;
  let stopping = false;
  const taskLeaseTimer = setInterval(() => {
    for (const taskId of taskInputs.keys()) store.touchActive(taskId);
  }, 5_000);
  taskLeaseTimer.unref();

  async function handlePartResearch(body, req, options = {}) {
    return runtime.runPartResearch(body, requestCtx(req, { ...body, ...options }));
  }

  async function handleCompanyResearch(body, req, options = {}) {
    return runtime.runCompanyResearch(body, requestCtx(req, { ...body, ...options }));
  }

  function createTask({ taskId, type, input, requestHash, idempotencyKey }) {
    const existing = store.lookupIdempotency(idempotencyKey, requestHash);
    if (existing) return existing;
    if (!accepting || taskInputs.size >= maxConcurrent + maxQueued) {
      return { overloaded: true };
    }
    const stored = store.create({ taskId, type, requestHash, idempotencyKey });
    if (stored.created) taskInputs.set(taskId, input);
    return stored;
  }

  function getTask(taskId) {
    return store.get(taskId);
  }

  function requestSnapshot(req) {
    return {
      headers: {
        "x-firecrawl-key": req.headers?.["x-firecrawl-key"] || "",
      },
    };
  }

  function startTask(taskId, req) {
    const execution = executeTask(taskId, req).finally(() => {
      executions.delete(taskId);
    });
    executions.set(taskId, execution);
    return execution;
  }

  function pump() {
    while (!stopping && controllers.size < maxConcurrent && pendingRuns.size) {
      const [taskId, req] = pendingRuns.entries().next().value;
      pendingRuns.delete(taskId);
      startTask(taskId, req).catch(() => {});
    }
  }

  async function executeTask(taskId, req) {
    const task = store.get(taskId);
    if (!task) return null;
    if (task.status === "cancelled" || task.status === "done" || task.status === "failed") return task;
    const input = taskInputs.get(taskId);
    if (!input) return task;
    const controller = new AbortController();
    controllers.set(taskId, controller);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("deadline_exceeded"));
    }, Math.max(1, deadlineMs));
    store.setRunning(taskId);
    const heartbeat = setInterval(() => store.touchRunning(taskId), Math.min(5_000, Math.max(1_000, Math.floor(deadlineMs / 4))));
    heartbeat.unref();
    store.appendEvent(taskId, { phase: "tool_call", name: task.type, payload: {} });
    try {
      const result =
        task.type === "company_research"
          ? await handleCompanyResearch(input, req, { signal: controller.signal })
          : await handlePartResearch(input, req, { signal: controller.signal });
      if (store.get(taskId)?.status === "cancelled") return store.get(taskId);
      if (timedOut) {
        store.fail(taskId, "deadline_exceeded");
        store.appendEvent(taskId, { phase: "degrade", name: "deadline", payload: { timeout: true } });
        return store.get(taskId);
      }
      const updated = store.complete(taskId, result);
      if (updated.updated) store.appendEvent(taskId, {
        taskId,
        phase: result.ok ? "observation" : "error",
        name: result.viaHarness ? "harness" : "core",
        payload: { ok: result.ok, viaHarness: Boolean(result.viaHarness) },
      });
    } catch (err) {
      if (store.get(taskId)?.status === "cancelled") return store.get(taskId);
      const errorCode = timedOut ? "deadline_exceeded" : stopping ? "service_stopping" : "runtime_failed";
      store.fail(taskId, errorCode);
      store.appendEvent(taskId, {
        phase: timedOut || stopping ? "degrade" : "error",
        name: timedOut ? "deadline" : stopping ? "service_stopping" : "exception",
        payload: { errorCode },
      });
    } finally {
      clearTimeout(timer);
      clearInterval(heartbeat);
      controllers.delete(taskId);
      taskInputs.delete(taskId);
      pump();
    }
    return store.get(taskId);
  }

  function runTask(taskId, req) {
    const task = store.get(taskId);
    if (!task || ["cancelled", "done", "failed"].includes(task.status)) return Promise.resolve(task);
    if (controllers.size >= maxConcurrent) {
      pendingRuns.set(taskId, requestSnapshot(req));
      return Promise.resolve(task);
    }
    return startTask(taskId, requestSnapshot(req));
  }

  function cancelTask(taskId) {
    const cancelled = store.cancel(taskId);
    if (cancelled.cancelled) {
      pendingRuns.delete(taskId);
      taskInputs.delete(taskId);
      controllers.get(taskId)?.abort(new Error("task_cancelled"));
    }
    return cancelled;
  }

  async function shutdown() {
    accepting = false;
    stopping = true;
    clearInterval(taskLeaseTimer);
    for (const taskId of pendingRuns.keys()) {
      pendingRuns.delete(taskId);
      taskInputs.delete(taskId);
      const failed = store.fail(taskId, "service_stopping");
      if (failed.updated) store.appendEvent(taskId, {
        phase: "degrade",
        name: "service_stopping",
        payload: { retryable: true, errorCode: "service_stopping" },
      });
    }
    for (const controller of controllers.values()) controller.abort(new Error("service_stopping"));
    await Promise.allSettled([...executions.values()]);
  }

  function stats() {
    return {
      localRunning: controllers.size,
      localQueued: pendingRuns.size,
      maxConcurrent,
      maxQueued,
      accepting,
    };
  }

  return {
    handlePartResearch,
    handleCompanyResearch,
    createTask,
    getTask,
    runTask,
    cancelTask,
    listEvents: store.listEvents,
    subscribeEvents: store.subscribe,
    shutdown,
    stats,
  };
}

export function listTaskRoutes() {
  return [
    "/v1/hello",
    "/v1/chat",
    "/v1/import/extract",
    "/v1/parts/research",
    "/v1/companies/research",
    "/v1/tasks",
  ];
}
