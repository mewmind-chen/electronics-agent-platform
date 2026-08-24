import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isAgentAvailable,
  resolveAgentRuntime,
  resolveModelPolicy,
} from "../../apps/agent-api/src/agent-runtime.js";
import { createRuntime } from "../../apps/agent-api/src/runtime.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("model policy is independent of execution mode", () => {
  const policy = resolveModelPolicy({ provider: "future-router", model: "x-1" }, {});
  assert.equal(policy.provider, "future-router");
  assert.equal(policy.model, "x-1");
  const runtime = createRuntime({
    env: { ELECTRONICS_HARNESS_STUB: "", DEEPSEEK_API_KEY: "" },
    harnessAvailable: false,
    modelPolicy: { provider: "future-router", model: "x-1", credentialEnv: "OTHER_KEY" },
  });
  assert.equal(runtime.modelPolicy.provider, "future-router");
  assert.equal(runtime.modelPolicy.model, "x-1");
  assert.equal(runtime.modelPolicy.credentialEnv, "OTHER_KEY");
});

test("isAgentAvailable does not hardcode DEEPSEEK_API_KEY", () => {
  const policy = resolveModelPolicy({ credentialEnv: "OTHER_KEY" }, {});
  assert.equal(
    isAgentAvailable({
      env: { OTHER_KEY: "ok", DEEPSEEK_API_KEY: "" },
      policy,
      processIsReady: true,
    }),
    true,
  );
  assert.equal(
    isAgentAvailable({
      env: { DEEPSEEK_API_KEY: "present", OTHER_KEY: "" },
      policy,
      processIsReady: true,
    }),
    false,
  );
});

test("resolveAgentRuntime is the router hook and stays replaceable", () => {
  const resolved = resolveAgentRuntime({
    env: { OTHER_KEY: "ok" },
    modelPolicy: { provider: "alt", model: "m2", credentialEnv: "OTHER_KEY" },
    overrideAvailable: true,
  });
  assert.equal(resolved.available, true);
  assert.equal(resolved.policy.provider, "alt");
  assert.equal(resolved.policy.model, "m2");
  assert.ok(["ok", "credential_missing", "runtime_process_missing"].includes(resolved.reason));
});

test("runtime.js does not decide availability by DEEPSEEK_API_KEY literal", () => {
  const src = readFileSync(join(root, "apps/agent-api/src/runtime.js"), "utf8");
  assert.doesNotMatch(src, /DEEPSEEK_API_KEY/);
  assert.match(src, /isAgentAvailable/);
  assert.match(src, /resolveAgentRuntime/);
});

test("no multi-model router is implemented yet", () => {
  const src = readFileSync(join(root, "apps/agent-api/src/agent-runtime.js"), "utf8");
  assert.doesNotMatch(src, /class ModelRouter|routeModel\(|pickModel\(/);
});
