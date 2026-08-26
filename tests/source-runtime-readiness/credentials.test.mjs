import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sourceReadiness } from "@electronics/market-sources";

const root = join(fileURLToPath(new URL("../../", import.meta.url)));

test("compose and example wire Platform-owned market credentials without values", () => {
  const compose = readFileSync(join(root, "compose.yaml"), "utf8");
  const env = readFileSync(join(root, ".env.example"), "utf8");
  for (const name of ["FIRECRAWL_API_KEY", "ANYSEARCH_API_KEY", "ICNET_COOKIE", "MOUSER_API_KEY"]) {
    assert.match(compose, new RegExp(`${name}: \\$\\{${name}:\\-\\}`));
    assert.match(env, new RegExp(`^${name}=`, "m"));
  }
  assert.doesNotMatch(env, /sk-[A-Za-z0-9]{10,}/);
  assert.doesNotMatch(compose, /sk-[A-Za-z0-9]{10,}/);
});
test("readiness exposes only safe booleans and reasons", () => {
  const previous = {
    FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY,
    ANYSEARCH_API_KEY: process.env.ANYSEARCH_API_KEY,
    ICNET_COOKIE: process.env.ICNET_COOKIE,
    MOUSER_API_KEY: process.env.MOUSER_API_KEY,
  };
  process.env.FIRECRAWL_API_KEY = "readiness-secret-firecrawl";
  process.env.ANYSEARCH_API_KEY = "readiness-secret-anysearch";
  process.env.ICNET_COOKIE = "readiness-secret-cookie";
  process.env.MOUSER_API_KEY = "readiness-secret-mouser";
  try {
    const readiness = sourceReadiness();
    const serialized = JSON.stringify(readiness);
    assert.equal(readiness.firecrawl.ready, true);
    assert.equal(readiness.anysearch.ready, true);
    assert.equal(readiness.icnet.optional, true);
    assert.equal(readiness.mouser.optional, true);
    assert.doesNotMatch(serialized, /readiness-secret/);
    assert.doesNotMatch(serialized, /fingerprint|prefix|length|cookie|token|key/i);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value == null) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("plugin source surface owns only Platform connection credentials", () => {
  const files = [
    join(root, "electronics-agent-plugin/manifest.json"),
    join(root, "electronics-agent-plugin/src/index.js"),
    join(root, "electronics-agent-plugin/tools/client.js"),
    join(root, "electronics-agent-plugin/skills/part-analysis.md"),
    join(root, "electronics-agent-plugin/skills/company-analysis.md"),
  ];
  const blob = files.map((file) => readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(blob, /FIRECRAWL_API_KEY|ANYSEARCH_API_KEY|ICNET_COOKIE|MOUSER_API_KEY/);
  assert.match(blob, /AGENT_API_URL/);
  assert.match(blob, /ELECTRONICS_AGENT_PLATFORM_TOKEN/);
});
