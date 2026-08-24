/**
 * Research/task helpers. Business routes go through AgentRuntime.
 * Credentials are request-scoped. Results are not persisted here.
 */

export function requestCtx(req, extra = {}) {
  return {
    firecrawlKey: extra.firecrawlKey || req.headers["x-firecrawl-key"] || process.env.FIRECRAWL_API_KEY || "",
    anysearchKey: extra.anysearchKey || process.env.ANYSEARCH_API_KEY || "",
    icnetCookie: extra.icnetCookie || process.env.ICNET_COOKIE || "",
    internalQuoteCount: extra.internalQuoteCount ?? 0,
    snapshots: extra.snapshots ?? [],
  };
}

export function createResearchHandlers(runtime) {
  async function handlePartResearch(body, req) {
    return runtime.runPartResearch(body, requestCtx(req, body));
  }

  async function handleCompanyResearch(body, req) {
    return runtime.runCompanyResearch(body, requestCtx(req, body));
  }

  const tasks = new Map();

  function createTask(type, input) {
    const taskId = `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const handle = { taskId, type, status: "queued", input, events: [], result: null, error: "" };
    tasks.set(taskId, handle);
    return handle;
  }

  function getTask(taskId) {
    return tasks.get(taskId) || null;
  }

  async function runTask(taskId, req) {
    const task = tasks.get(taskId);
    if (!task) return null;
    task.status = "running";
    task.events.push({ taskId, phase: "tool_call", name: task.type, payload: {} });
    try {
      const result =
        task.type === "company_research"
          ? await handleCompanyResearch(task.input, req)
          : await handlePartResearch(task.input, req);
      task.result = result;
      task.status = result.ok ? "done" : "failed";
      task.error = result.ok ? "" : JSON.stringify(result.errors || result.error || "failed");
      task.events.push({
        taskId,
        phase: result.ok ? "observation" : "error",
        name: result.viaHarness ? "harness" : "core",
        payload: { ok: result.ok, viaHarness: Boolean(result.viaHarness) },
      });
    } catch (err) {
      task.status = "failed";
      task.error = err instanceof Error ? err.message : "failed";
      task.events.push({ taskId, phase: "error", name: "exception", payload: { error: task.error } });
    }
    return task;
  }

  return { handlePartResearch, handleCompanyResearch, createTask, getTask, runTask };
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
