/**
 * electronics-agent — user-side DeepSeek Harness plugin.
 * Tools POST frozen Agent API contracts. They do not import Domain Core.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { execute as partResearch } from "../tools/part_research/index.js";
import { execute as importExtract } from "../tools/import_extract/index.js";
import { execute as companyResearch } from "../tools/company_research/index.js";
import {
  markdownBlocks,
  presentCallView,
  presentCompanyMarkdown,
  presentImportMarkdown,
  presentPartMarkdown,
  presentResultView,
} from "./present.js";

export const name = "electronics-agent";
export const inject = ["tools", "skills"];

function parseSkillMarkdown(text) {
  const match = String(text || "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  const meta = {};
  let body = String(text || "").trim();
  if (match) {
    body = match[2].trim();
    for (const line of match[1].split(/\r?\n/)) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return { meta, body };
}

function registerBundledSkills(ctx) {
  if (typeof ctx.skills?.register !== "function") return;
  const dir = join(dirname(fileURLToPath(import.meta.url)), "../skills");
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".md"))) {
    const abs = join(dir, file);
    const { meta, body } = parseSkillMarkdown(readFileSync(abs, "utf8"));
    ctx.skills.register({
      name: meta.name || file.replace(/\.md$/, ""),
      description: meta.description || meta.name || file,
      content: body,
      source: "bundled",
      path: abs,
      provider: "electronics-agent",
      invocation: {
        modelInvocable: true,
        userInvocable: String(meta["user-invocable"]).toLowerCase() !== "false",
      },
      resourceBase: { kind: "directory", path: dir },
    });
  }
}

function reportOutput(present) {
  return {
    schema: { type: "object", additionalProperties: true },
    render(args, value) {
      return markdownBlocks(present(value, args));
    },
    presentationMeta(args, value) {
      return { markdown: present(value, args) };
    },
  };
}

export function apply(ctx) {
  process.stderr.write("[electronics-agent] plugin loaded\n");
  registerBundledSkills(ctx);
  process.stderr.write("[electronics-agent] tools: part_research, import_extract, company_research\n");

  ctx.tools.register(
    defineTool({
      name: "part_research",
      description:
        "Research an electronics MPN via electronics-agent-platform POST /v1/parts/research. Returns PartResearchResult. Never writes a business database.",
      parameters: {
        mpn: { type: "string", required: true, description: "MPN copied verbatim" },
        goal: { type: "string" },
        steps: { type: "array", items: { type: "string" } },
        mode: { type: "string", description: "auto|agent|core" },
      },
      output: reportOutput(presentPartMarkdown),
      presentCall(args) {
        return presentCallView(`分析型号 ${args.mpn || ""}`.trim());
      },
      presentResult(args, result) {
        return presentResultView(`型号分析 ${args.mpn || ""}`.trim(), result);
      },
      execute: partResearch,
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "import_extract",
      description:
        "Extract ImportCandidate rows via POST /v1/import/extract. Supports excel, csv, image, pdf, word, text. Returns candidates only. Never confirmImport or write a database.",
      parameters: {
        sourceType: { type: "string", required: true, description: "excel|csv|pdf|word|image|text" },
        kind: { type: "string", description: "offer|inquiry|stock|transit" },
        text: { type: "string" },
        fileBase64: { type: "string", description: "file bytes; images and spreadsheets" },
        mime: { type: "string" },
        filename: { type: "string" },
        mapping: { type: "object", additionalProperties: true },
        mode: { type: "string" },
      },
      output: reportOutput(presentImportMarkdown),
      presentCall(args) {
        return presentCallView(`提取导入候选（${args.sourceType || "file"}）`);
      },
      presentResult(args, result) {
        return presentResultView(`导入候选（${args.sourceType || "file"}）`, result);
      },
      execute: importExtract,
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "company_research",
      description:
        "Research a supplier/customer via POST /v1/companies/research. Returns CompanyResearchResult. Never writes a business database.",
      parameters: {
        company: { type: "string", required: true },
        goal: { type: "string" },
        steps: { type: "array", items: { type: "string" } },
        mode: { type: "string" },
      },
      output: reportOutput(presentCompanyMarkdown),
      presentCall(args) {
        return presentCallView(`分析公司 ${args.company || ""}`.trim());
      },
      presentResult(args, result) {
        return presentResultView(`公司分析 ${args.company || ""}`.trim(), result);
      },
      execute: companyResearch,
    }),
  );
}
