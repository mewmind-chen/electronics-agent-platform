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
    inventory: context.inventory || extra.inventory,
    quotation: context.quotation || extra.quotation,
    customer: context.customer || extra.customer,
    internalQuoteCount: extra.internalQuoteCount ?? context.quotation?.openCount ?? 0,
    snapshots: extra.snapshots ?? context.snapshots ?? [],
    previousLcscPrice: extra.previousLcscPrice ?? context.previousLcscPrice ?? null,
    signal: extra.signal,
  };
}

export function createResearchHandlers(runtime, { store, deadlineMs = Number(process.env.TASK_DEADLINE_MS || 120_000) } = {}) {
  if (!store) throw new Error("createResearchHandlers requires a durable TaskStore");
  const taskInputs = new Map();
  const controllers = new Map();

  async function handlePartResearch(body, req, options = {}) {
    return runtime.runPartResearch(body, requestCtx(req, { ...body, ...options }));
  }

  async function handleCompanyResearch(body, req, options = {}) {
    return runtime.runCompanyResearch(body, requestCtx(req, { ...body, ...options }));
  }

  function createTask({ taskId, type, input, requestHash, idempotencyKey }) {
    const stored = store.create({ taskId, type, requestHash, idempotencyKey });
    if (stored.created) taskInputs.set(taskId, input);
    return stored;
  }

  function getTask(taskId) {
    return store.get(taskId);
  }

  async function runTask(taskId, req) {
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
      const error = timedOut ? "deadline_exceeded" : err instanceof Error ? err.message : "failed";
      store.fail(taskId, error);
      store.appendEvent(taskId, { phase: timedOut ? "degrade" : "error", name: timedOut ? "deadline" : "exception", payload: { error } });
    } finally {
      clearTimeout(timer);
      controllers.delete(taskId);
      taskInputs.delete(taskId);
    }
    return store.get(taskId);
  }

  function cancelTask(taskId) {
    const cancelled = store.cancel(taskId);
    if (cancelled.cancelled) controllers.get(taskId)?.abort(new Error("task_cancelled"));
    return cancelled;
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
