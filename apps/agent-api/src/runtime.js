/**
 * DeepSeekHarnessRuntime — Phase 1 ping subset.
 *
 * The adapter launches the official dsh-jsonrpc-agent bin with
 * runtime/jsonrpc.cordis.yml. It must never:
 *   - fetch dsh web HTTP
 *   - fetch https://api.deepseek.com/v1/chat/completions
 *   - spawn a homemade agent loop
 */
import { DeepSeekHarness } from "@deepseek-ai/dsh-sdk-client";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const runtimeDir = join(root, "runtime");
const cordis = join(runtimeDir, "jsonrpc.cordis.yml");

function resolveJsonrpcBin() {
  const candidates = [
    join(runtimeDir, "node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js"),
    join(root, "node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    "official dsh-jsonrpc-agent bin not found; run npm install in electronics-agent-platform/runtime",
  );
}

function extractHelloPing(result) {
  const events = Array.isArray(result?.events) ? result.events : [];
  for (const ev of events) {
    const name = ev?.name ?? ev?.type ?? "";
    const payload = ev?.payload ?? ev;
    const tool = payload?.name ?? payload?.toolName ?? payload?.tool ?? "";
    const raw =
      payload?.output ??
      payload?.result ??
      payload?.value ??
      payload?.content ??
      payload?.text ??
      null;
    if (String(tool).includes("hello_ping") || String(name).includes("hello_ping")) {
      const parsed = coerceJson(raw);
      if (parsed && parsed.ok === true && parsed.plugin === "electronics-hello") return parsed;
    }
    const nested = findHelloInUnknown(payload);
    if (nested) return nested;
  }
  const fromText = findHelloInUnknown(result?.finalResponse);
  if (fromText) return fromText;
  for (const n of result?.notifications ?? []) {
    const hit = findHelloInUnknown(n);
    if (hit) return hit;
  }
  return null;
}

function coerceJson(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && raw.ok === true) return raw;
  if (typeof raw !== "string") return null;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    if (parsed && parsed.ok === true && parsed.plugin === "electronics-hello") return parsed;
  } catch {
    return null;
  }
  return null;
}

function findHelloInUnknown(value, depth = 0) {
  if (depth > 8 || value == null) return null;
  const direct = coerceJson(value);
  if (direct) return direct;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findHelloInUnknown(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value)) {
      const hit = findHelloInUnknown(v, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

export function createRuntime() {
  return {
    async ping(token) {
      if (!existsSync(cordis)) {
        throw new Error(`missing ${cordis}`);
      }
      const bin = resolveJsonrpcBin();
      const sessionRoot = join(root, ".dsh-platform/sessions");
      // cwd must stay inside this git repo so official skill discovery
      // (nearest .git ancestor → <root>/.dsh/skills) finds hello.md.
      const workspace = root;
      const harness = new DeepSeekHarness({
        launch: {
          command: process.execPath,
          args: [bin, cordis],
          cwd: runtimeDir,
          env: {
            ...process.env,
            DSH_CORDIS_CONFIG: cordis,
            DSH_CWD: workspace,
            DSH_SESSION_ROOT: sessionRoot,
            DSH_SYSTEM_PROMPT:
              process.env.DSH_SYSTEM_PROMPT ||
              "You are the electronics-agent-platform Phase 1 probe. Call hello_ping with the given token and return only that tool JSON.",
          },
        },
        cwd: workspace,
        provider: "deepseek-official",
        model: process.env.DSH_MODEL || "deepseek-chat",
        maxTokens: 1024,
      });
      try {
        const result = await harness.run(
          `Ping the electronics platform. Load skill hello if needed. Call hello_ping with token ${JSON.stringify(token)}. Return the tool JSON unchanged.`,
          { sessionId: `hello-${Date.now()}` },
        );
        const ping = extractHelloPing(result);
        if (!ping) {
          const err = new Error("official runtime returned no hello_ping result");
          err.finalResponse = result.finalResponse;
          err.eventCount = result.events?.length ?? 0;
          throw err;
        }
        return ping;
      } finally {
        await harness.close();
      }
    },
  };
}
