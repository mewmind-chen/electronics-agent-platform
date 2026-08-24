#!/usr/bin/env node
/**
 * Container-only production guard. Local `npm run api` remains convenient for
 * development, while an image must never expose the API without a token.
 */
const token = String(process.env.AGENT_API_TOKEN || "").trim();
if (!token) {
  process.stderr.write("[agent-api] AGENT_API_TOKEN is required in container deployments\n");
  process.exit(64);
}

await import("../apps/agent-api/src/index.js");
