/**
 * electronics-hello — official DeepSeek Harness plugin (Phase 1 probe).
 *
 * Form required by official docs:
 *   export const name
 *   export const inject
 *   export function apply(ctx)
 *
 * Tool registration uses defineTool from @deepseek-ai/dsh-tools.
 * This module must not call /chat/completions or touch a business database.
 */
import { defineTool } from "@deepseek-ai/dsh-tools";

export const name = "electronics-hello";
export const inject = ["tools"];

export function apply(ctx) {
  process.stderr.write("[electronics-hello] plugin loaded\n");
  ctx.tools.register(
    defineTool({
      name: "hello_ping",
      description:
        "Phase 1 probe. Echo a token to prove the official Harness tool path. Call this when the user asks to ping the electronics platform.",
      parameters: {
        token: {
          type: "string",
          required: true,
          description: "opaque probe token",
        },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            ok: { type: "boolean" },
            token: { type: "string" },
            runtime: { type: "string" },
            plugin: { type: "string" },
          },
        },
        render(_args, value) {
          return [{ type: "text", text: JSON.stringify(value) }];
        },
      },
      async execute(args) {
        return {
          ok: true,
          token: args.token,
          runtime: "deepseek-harness",
          plugin: "electronics-hello",
        };
      },
    }),
  );
}
