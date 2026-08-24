#!/usr/bin/env node
/**
 * RC live: plugin tools → Agent API. Does not print tokens.
 * Writes tests/plugin-rc/live-results.json
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const pluginRoot = join(root, "electronics-agent-plugin");
const outDir = join(root, "tests/plugin-rc");
const port = Number(process.env.AGENT_API_PORT || 18732);
const token = String(process.env.ELECTRONICS_AGENT_PLATFORM_TOKEN || "plugin-rc-live-token").trim();
const url = `http://127.0.0.1:${port}`;

function timeout(ms, label) {
  const err = new Error(label || "timeout");
  err.code = "TIMEOUT";
  return err;
}

async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeout(ms, label)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitHealth(base, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("health timeout");
}

async function loadTools() {
  const mod = await import(join(pluginRoot, "src/index.js"));
  const tools = new Map();
  mod.apply({
    tools: {
      register(tool) {
        tools.set(tool.name, tool);
      },
    },
  });
  return tools;
}

const httpLog = [];
const origFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const res = await origFetch(input, init);
  try {
    const u = new URL(typeof input === "string" ? input : String(input));
    if (u.pathname.startsWith("/v1/")) {
      httpLog.push({ method: String(init?.method || "GET"), path: u.pathname, statusCode: res.status });
    }
  } catch {
    /* ignore */
  }
  return res;
};

const child = spawn(process.execPath, [join(root, "apps/agent-api/src/index.js")], {
  cwd: root,
  env: {
    ...process.env,
    AGENT_API_HOST: "127.0.0.1",
    AGENT_API_PORT: String(port),
    AGENT_API_TOKEN: token,
    ELECTRONICS_IGNORE_LIVE: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

const evidence = {
  version: "0.1.0",
  chainPrefix: [
    "electronics-agent plugin tools",
    "POST Agent API",
    "electronics-agent-platform",
  ],
  ok: false,
};

try {
  process.env.AGENT_API_URL = url;
  process.env.ELECTRONICS_AGENT_PLATFORM_TOKEN = token;
  await waitHealth(url);
  const tools = await loadTools();

  const partRaw = await withTimeout(
    tools.get("part_research").execute({ mpn: "TPS54560DDAR", mode: "core" }),
    60_000,
    "part timeout",
  );
  const partMd = tools.get("part_research").output.render({ mpn: "TPS54560DDAR" }, partRaw)
    .map((b) => b.text || "")
    .join("\n");

  const importRaw = await withTimeout(
    tools.get("import_extract").execute({
      sourceType: "image",
      kind: "offer",
      mime: "image/png",
      filename: "quote.png",
      fileBase64: "not-a-real-png",
    }),
    30_000,
    "import timeout",
  );
  const importMd = tools.get("import_extract").output.render({ sourceType: "image" }, importRaw)
    .map((b) => b.text || "")
    .join("\n");

  const companyRaw = await withTimeout(
    tools.get("company_research").execute({ company: "TI", mode: "core" }),
    60_000,
    "company timeout",
  );
  const companyMd = tools.get("company_research").output.render({ company: "TI" }, companyRaw)
    .map((b) => b.text || "")
    .join("\n");

  evidence.scenarios = {
    part: {
      prompt: "分析 TPS54560DDAR",
      tool: "part_research",
      http: "/v1/parts/research",
      mpn: partRaw.mpn || null,
      ok: partRaw.ok !== false,
      error: partRaw.error || null,
      userVisibleHeading: partMd.includes("# 型号分析报告"),
      dumpedRawJson: /^\s*\{/.test(partMd),
    },
    importImage: {
      prompt: "上传报价图片并识别",
      tool: "import_extract",
      http: "/v1/import/extract",
      sourceType: "image",
      ok: importRaw.ok === true,
      error: importRaw.error || null,
      candidates: Array.isArray(importRaw.candidates) ? importRaw.candidates.length : null,
      userVisibleFailure: /导入失败/.test(importMd) && /vision_unavailable/.test(importMd),
      fabricated: /TPS54560DDAR/.test(importMd),
    },
    company: {
      prompt: "分析供应商 TI",
      tool: "company_research",
      http: "/v1/companies/research",
      ok: companyRaw.ok !== false,
      error: companyRaw.error || null,
      evidenceCount: Array.isArray(companyRaw.evidence) ? companyRaw.evidence.length : 0,
      unknownWithoutEvidence: /未知/.test(companyMd) && /不编造/.test(companyMd),
      inventedContacts: /联系人：/.test(companyMd),
    },
  };
  evidence.httpLog = httpLog.filter((r) => String(r.path || "").startsWith("/v1/"));
  evidence.ok = Boolean(
    evidence.scenarios.part.userVisibleHeading
      && !evidence.scenarios.part.dumpedRawJson
      && evidence.scenarios.importImage.userVisibleFailure
      && evidence.scenarios.importImage.candidates === 0
      && !evidence.scenarios.importImage.fabricated
      && evidence.scenarios.company.unknownWithoutEvidence
      && !evidence.scenarios.company.inventedContacts,
  );
} catch (err) {
  evidence.error = err instanceof Error ? err.message : String(err);
} finally {
  await new Promise((r) => setTimeout(r, 400));
  child.kill("SIGTERM");
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "live-results.json"), `${JSON.stringify(evidence, null, 2)}\n`);
process.stderr.write(`[plugin-rc live] ok=${evidence.ok}\n`);
if (!evidence.ok) process.exit(1);
