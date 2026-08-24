import { postJson } from "../client.js";

export async function execute(args = {}) {
  const sourceType = String(args.sourceType || "").trim();
  if (!sourceType) return { ok: false, error: "contract_error", reason: "sourceType required", candidates: [] };
  const body = {
    kind: args.kind || "offer",
    sourceType,
    mode: args.mode || "auto",
  };
  if (args.text != null) body.text = args.text;
  if (args.fileBase64 != null) body.fileBase64 = args.fileBase64;
  if (args.mime != null) body.mime = args.mime;
  if (args.filename != null) body.filename = args.filename;
  if (args.mapping != null) body.mapping = args.mapping;
  return postJson("/v1/import/extract", body);
}
