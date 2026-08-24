import { defineTool } from "@deepseek-ai/dsh-tools";
import { researchCompany } from "@electronics/company-intelligence-core";

export const name = "electronics-company";
export const inject = ["tools"];

export function apply(ctx) {
  process.stderr.write("[electronics-company] plugin loaded\n");
  ctx.tools.register(
    defineTool({
      name: "company_research",
      description: "Research a supplier/company. Returns CompanyResearchResult. Never writes a business database.",
      parameters: {
        company: { type: "string", required: true },
        goal: { type: "string" },
        firecrawlKey: { type: "string" },
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render(_a, v) {
          return [{ type: "text", text: JSON.stringify(v) }];
        },
      },
      async execute(args) {
        return researchCompany({ company: args.company, goal: args.goal }, { firecrawlKey: args.firecrawlKey });
      },
    }),
  );
}
