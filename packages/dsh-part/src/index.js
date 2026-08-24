import { defineTool } from "@deepseek-ai/dsh-tools";
import { researchPart } from "@electronics/part-intelligence-core";

export const name = "electronics-part";
export const inject = ["tools"];

export function apply(ctx) {
  process.stderr.write("[electronics-part] plugin loaded\n");
  ctx.tools.register(
    defineTool({
      name: "part_research",
      description: "Research an electronics MPN via market-sources. Returns PartResearchResult. Never writes a business database.",
      parameters: {
        mpn: { type: "string", required: true },
        goal: { type: "string" },
        steps: { type: "array", items: { type: "string" } },
        firecrawlKey: { type: "string" },
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render(_a, v) {
          return [{ type: "text", text: JSON.stringify(v) }];
        },
      },
      async execute(args) {
        return researchPart(
          { mpn: args.mpn, goal: args.goal, steps: args.steps },
          { firecrawlKey: args.firecrawlKey },
        );
      },
    }),
  );
}
