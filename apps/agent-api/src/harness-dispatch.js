/**
 * Official plugin dispatch used by tests and by the runtime stub.
 * Loads dsh-* via apply()+defineTool. This is not a homemade agent loop.
 */
import { apply as applyHello } from "@electronics/dsh-hello";
import { apply as applyImport } from "@electronics/dsh-import";
import { apply as applyPart } from "@electronics/dsh-part";
import { apply as applyCompany } from "@electronics/dsh-company";

export function loadOfficialTools() {
  const tools = new Map();
  const ctx = {
    tools: {
      register(tool) {
        if (!tool?.name || typeof tool.execute !== "function") {
          throw new Error("official plugin did not register a defineTool");
        }
        tools.set(tool.name, tool);
      },
    },
  };
  applyHello(ctx);
  applyImport(ctx);
  applyPart(ctx);
  applyCompany(ctx);
  return tools;
}

function jsonArgs(args) {
  return JSON.parse(JSON.stringify(args ?? {}));
}

export async function executeOfficialTool(tools, name, args) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`official tool not registered: ${name}`);
  return tool.execute(jsonArgs(args), { signal: AbortSignal.timeout(60_000) });
}

function mpnish(token) {
  const t = String(token || "").trim();
  if (t.length < 5 || t.length > 40) return false;
  if (!/[A-Za-z]/.test(t) || !/\d/.test(t)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9+._\/-]{3,}$/.test(t);
}

/**
 * Scripted official-tool path for CI: follows Import/Part/Company Skills
 * by calling the registered dsh tools. Production uses DeepSeekHarness.run.
 */
export async function stubOfficialAgent(job, tools = loadOfficialTools()) {
  const called = [];
  const call = async (name, args) => {
    called.push(name);
    return executeOfficialTool(tools, name, args);
  };

  if (job.kind === "hello") {
    const out = await call("hello_ping", { token: job.token });
    return { ...out, viaHarness: false, usedAi: false, route: "stub", toolsCalled: called };
  }

  if (job.kind === "import") {
    const input = job.input || {};
    const classified = await call("import_classify", {
      sourceType: input.sourceType,
      filename: input.filename,
      mime: input.mime,
    });
    if (classified.class === "table") {
      const preview = await call("import_table_preview", {
        sourceType: input.sourceType,
        fileBase64: input.fileBase64,
        text: input.text,
        filename: input.filename,
        mime: input.mime,
      });
      const header = preview.header || [];
      const columns = [];
      for (const h of header) {
        const key = String(h).toLowerCase();
        if (/型号|mpn|p\/n|part|料号|^pn$/.test(key)) columns.push({ header: h, target: "mpn" });
        else if (/qty|数量|available|库存/.test(key)) columns.push({ header: h, target: "qty" });
        else if (/brand|厂家|品牌|mfr/.test(key)) columns.push({ header: h, target: "brand" });
        else if (/usd|price|单价|价钱/.test(key)) columns.push({ header: h, target: "price" });
      }
      if (!columns.some((c) => c.target === "mpn")) {
        return { ok: true, candidates: [], usedAi: false, viaHarness: false, route: "stub", toolsCalled: called, reason: "no_mpn_header" };
      }
      const applied = await call("import_apply_mapping", {
        sourceType: input.sourceType,
        mapping: { columns },
        defaultKind: input.kind,
        fileBase64: input.fileBase64,
        text: input.text,
        filename: input.filename,
        headerIndex: preview.headerIndex,
      });
      return {
        ok: applied.ok !== false,
        candidates: applied.candidates || [],
        mapping: applied.mapping || { columns },
        usedAi: false,
        viaHarness: false,
        route: "stub",
        toolsCalled: called,
      };
    }

    const normalized = await call("import_normalize_text", { text: input.text || "" });
    const tokens = String(normalized.normalized || input.text || "").split(/\s+/);
    const rows = [];
    for (const tok of tokens) {
      if (!mpnish(tok)) continue;
      rows.push({ kind: input.kind || "offer", mpn: tok, qtyRaw: (input.text || "").match(/\d+\s*[kKwW万]/)?.[0] || null });
    }
    const validated = await call("import_validate_rows", {
      defaultKind: input.kind || "offer",
      sourceText: normalized.normalized || input.text || "",
      rows,
    });
    return {
      ok: true,
      candidates: validated.candidates || [],
      usedAi: false,
      viaHarness: false,
      route: "stub",
      toolsCalled: called,
    };
  }

  if (job.kind === "part") {
    const out = await call("part_research", {
      mpn: job.input.mpn,
      goal: job.input.goal,
      steps: job.input.steps,
      firecrawlKey: job.ctx?.firecrawlKey,
    });
    return { ...out, viaHarness: false, usedAi: false, route: "stub", toolsCalled: called };
  }

  if (job.kind === "company") {
    const out = await call("company_research", {
      company: job.input.company,
      goal: job.input.goal,
      firecrawlKey: job.ctx?.firecrawlKey,
    });
    return { ...out, viaHarness: false, usedAi: false, route: "stub", toolsCalled: called };
  }

  throw new Error(`unknown harness job ${job.kind}`);
}

export function coerceJsonObject(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return null;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function extractNamedTool(result, toolName) {
  const events = Array.isArray(result?.events) ? result.events : [];
  const names = [];
  const rememberName = (value) => {
    const tool = value?.name ?? value?.toolName ?? value?.tool ?? "";
    if (String(tool).includes(toolName) && !names.includes(String(tool))) names.push(String(tool));
  };
  const collectNames = (value, depth = 0) => {
    if (depth > 8 || value == null) return;
    if (typeof value !== "object") return;
    rememberName(value);
    if (Array.isArray(value)) {
      for (const item of value) collectNames(item, depth + 1);
      return;
    }
    for (const v of Object.values(value)) collectNames(v, depth + 1);
  };
  const looksLikeOutput = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    if (toolName === "import_") {
      return Array.isArray(value.candidates) || (value.ok === true && value.mapping && typeof value.mapping === "object");
    }
    if (toolName === "part_research") {
      return typeof value.ok === "boolean" && typeof value.mpn === "string" && ("verdict" in value || "errors" in value);
    }
    if (toolName === "company_research") {
      return typeof value.ok === "boolean" && typeof value.company === "string" && ("verdict" in value || "errors" in value);
    }
    if (toolName === "hello_ping") {
      return value.plugin === "electronics-hello" || value.runtime === "deepseek-harness" || value.token === "live-qualify";
    }
    return false;
  };
  const visit = (value, depth = 0, key = "") => {
    if (depth > 8 || value == null) return null;
    if (["arguments", "args", "argumentsDelta"].includes(key)) return null;
    const direct = coerceJsonObject(value);
    if (looksLikeOutput(direct)) return direct;
    if (typeof value === "object") {
      rememberName(value);
      const tool = value.name ?? value.toolName ?? value.tool ?? "";
      if (String(tool).includes(toolName)) {
        const raw = value.output ?? value.result ?? value.value ?? value.content ?? value.text ?? null;
        const parsed = coerceJsonObject(raw);
        if (looksLikeOutput(parsed)) return parsed;
      }
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const hit = visit(item, depth + 1, key);
        if (hit) return hit;
      }
      return null;
    }
    if (typeof value === "object") {
      for (const [childKey, v] of Object.entries(value)) {
        const hit = visit(v, depth + 1, childKey);
        if (hit) return hit;
      }
    }
    return null;
  };
  collectNames(result?.finalResponse);
  for (const ev of events) collectNames(ev);
  for (const n of result?.notifications ?? []) collectNames(n);
  const fromText = visit(result?.finalResponse);
  if (fromText) {
    return { value: fromText, toolsCalled: names.length ? names : [toolName] };
  }
  for (const ev of events) {
    const hit = visit(ev);
    if (hit) return { value: hit, toolsCalled: names.length ? names : [toolName] };
  }
  for (const n of result?.notifications ?? []) {
    const hit = visit(n);
    if (hit) return { value: hit, toolsCalled: names.length ? names : [toolName] };
  }
  return null;
}
