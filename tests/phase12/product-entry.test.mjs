/**
 * Phase 12 — plugin as the user product entry.
 * Desktop bundle patch must resolve after `dsh plugin add`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const pluginRoot = join(root, "electronics-agent-plugin");

function pluginFile(rel) {
  return readFileSync(join(pluginRoot, rel), "utf8");
}

test("desktop bundle patch uses the package name so the profile can load the plugin", () => {
  const patch = pluginFile("cordis.patch.yml");
  assert.match(patch, /id:\s*electronics-agent/);
  assert.match(patch, /name:\s*electronics-agent\s*$/m);
  assert.doesNotMatch(patch, /name:\s*['"]?\.\/src\/index\.js/);
  assert.doesNotMatch(patch, /require\.resolve/);
  assert.doesNotMatch(patch, /electronics-agent-skills/);
  assert.doesNotMatch(patch, /@electronics\/dsh-(hello|import|part|company)/);
});

test("plugin apply registers bundled skills without a second skill-filesystem", async () => {
  const { apply, inject } = await import(join(pluginRoot, "src/index.js"));
  assert.deepEqual(inject, ["tools", "skills"]);
  const skills = [];
  apply({
    tools: { register() {} },
    skills: {
      register(skill) {
        skills.push(skill);
        return () => {};
      },
    },
  });
  assert.deepEqual(skills.map((s) => s.name).sort(), ["company-analysis", "import-analysis", "part-analysis"]);
  for (const skill of skills) {
    assert.equal(skill.invocation.userInvocable, true);
    assert.equal(skill.invocation.modelInvocable, true);
    assert.match(skill.content, /Never write|不写/);
  }
});

test("skills tell the assistant to write a user report instead of dumping Tool JSON", () => {
  for (const name of ["part-analysis.md", "import-analysis.md", "company-analysis.md"]) {
    const skill = pluginFile(join("skills", name));
    const bundled = pluginFile(join(".dsh/skills", name));
    assert.equal(skill, bundled, `${name} must stay in sync`);
    assert.match(skill, /user-invocable:\s*true/);
    assert.match(skill, /不要把完整 Tool JSON|不要把完整工具 JSON|不要直接展示 Tool JSON|禁止把完整 JSON/);
    assert.match(skill, /业务可读|报告/);
    assert.doesNotMatch(skill, /Return the tool JSON|Return the `PartResearchResult` JSON|Return `CompanyResearchResult`/);
    assert.doesNotMatch(skill, /INSERT INTO/i);
  }
  assert.match(pluginFile("skills/part-analysis.md"), /part-analysis|part_research/);
  assert.match(pluginFile("skills/import-analysis.md"), /sourceType.*image|image/);
  assert.match(pluginFile("skills/import-analysis.md"), /vision_unavailable/);
  assert.match(pluginFile("skills/company-analysis.md"), /company_research/);
});
