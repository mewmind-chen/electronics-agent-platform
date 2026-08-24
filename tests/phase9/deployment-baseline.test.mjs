import { readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function file(path) {
  return readFileSync(join(root, path), "utf8");
}

async function waitHealth(url) {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Server is starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`health timeout: ${url}`);
}

test("deployment files require runtime auth, bind the container safely, and exclude secrets", () => {
  const dockerfile = file("Dockerfile");
  const ignore = file(".dockerignore");
  const compose = file("compose.yaml");
  const example = file(".env.example");
  const workflow = file(".github/workflows/ci.yml");
  const runtime = file("runtime/jsonrpc.cordis.yml");

  assert.match(dockerfile, /FROM node:22-alpine/);
  assert.match(dockerfile, /AGENT_API_HOST=0\.0\.0\.0/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /scripts\/start-container\.mjs/);
  assert.match(dockerfile, /HEALTHCHECK/);
  for (const ignored of [".env", ".credentials.yaml", ".dsh-platform", "node_modules"]) {
    assert.match(ignore, new RegExp(`^${ignored.replace(".", "\\.")}$`, "m"));
  }
  assert.match(compose, /AGENT_API_TOKEN: \$\{AGENT_API_TOKEN:\?/);
  assert.match(compose, /AGENT_API_HOST: 0\.0\.0\.0/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(example, /^AGENT_API_TOKEN=$/m);
  assert.match(workflow, /npm test/);
  assert.doesNotMatch(workflow, /cache:\s*npm/);
  assert.match(runtime, /mode:\s*read-only/);
  assert.doesNotMatch(runtime, /mode:\s*danger-full-access/);
});

test("container startup refuses a missing token", () => {
  const out = spawnSync(process.execPath, ["scripts/start-container.mjs"], {
    cwd: root,
    env: { ...process.env, AGENT_API_TOKEN: "", ELECTRONICS_AGENT_API_NO_LISTEN: "1" },
    encoding: "utf8",
  });
  assert.equal(out.status, 64);
  assert.match(out.stderr, /AGENT_API_TOKEN is required/);
});

test("deployment smoke performs authenticated research with Radar and Workbench context shapes", async () => {
  const port = 18806;
  const token = "deployment-smoke-token";
  const child = spawn(process.execPath, [join(root, "apps/agent-api/src/index.js")], {
    cwd: root,
    env: {
      ...process.env,
      AGENT_API_HOST: "127.0.0.1",
      AGENT_API_PORT: String(port),
      AGENT_API_TOKEN: token,
      ELECTRONICS_IGNORE_LIVE: "1",
      DEEPSEEK_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const url = `http://127.0.0.1:${port}`;
    await waitHealth(`${url}/health`);
    const smoke = spawnSync(process.execPath, ["scripts/deployment-smoke.mjs", "--url", url, "--token", token], {
      cwd: root,
      env: { ...process.env, AGENT_API_TOKEN: "" },
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(smoke.status, 0, smoke.stderr);
    assert.match(smoke.stdout, /Radar\/Workbench request contexts/);
    assert.equal(smoke.stdout.includes(token), false);
  } finally {
    child.kill("SIGTERM");
  }
});
