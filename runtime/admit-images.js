/**
 * Admit encoded image content blocks into durable attachment refs.
 * JSON-RPC session/prompt otherwise freezes {type:image, data} as an invalid
 * ImageBlock; pi-ai / llm-deepseek then cannot read the picture.
 */
import { admitEncodedImages } from "@deepseek-ai/dsh-attachment";
import { HarnessSdkJsonRpcServer } from "@deepseek-ai/dsh-sdk-jsonrpc-server";

const ACCEPTED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function encodedImageFromBlock(block) {
  if (!block || block.type !== "image") return null;
  if (block.attachment?.attachmentId) return null;
  const mediaType = block.mediaType || block.attachment?.mediaType;
  const data = block.data || block.attachment?.data;
  const name = block.name || block.attachment?.name;
  if (!ACCEPTED.has(mediaType) || typeof data !== "string" || !data) return null;
  return name ? { mediaType, data, name } : { mediaType, data };
}

export async function admitPromptImages(attachments, contentBlocks) {
  const blocks = Array.isArray(contentBlocks) ? [...contentBlocks] : [];
  const pending = [];
  const indexes = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const encoded = encodedImageFromBlock(blocks[i]);
    if (!encoded) continue;
    indexes.push(i);
    pending.push(encoded);
  }
  if (!pending.length) return blocks;
  if (!attachments) {
    throw new Error("encoded image blocks require the durable attachment service");
  }
  const refs = await admitEncodedImages(attachments, pending);
  return blocks.map((block, i) => {
    const slot = indexes.indexOf(i);
    if (slot < 0) return block;
    return { type: "image", attachment: refs[slot] };
  });
}

export const name = "electronics-vision-admit";
export const inject = ["attachments"];

export function wrapJsonRpcPrompt(Server, getAttachments) {
  if (typeof Server?.prototype?.prompt !== "function") return;
  if (Server.prototype.prompt.__electronicsVisionAdmit) return;
  const orig = Server.prototype.prompt;
  async function prompt(params) {
    const attachments = typeof getAttachments === "function" ? getAttachments.call(this) : getAttachments;
    const contentBlocks = await admitPromptImages(attachments, params?.contentBlocks);
    return orig.call(this, { ...params, contentBlocks });
  }
  prompt.__electronicsVisionAdmit = true;
  Server.prototype.prompt = prompt;
}

export function apply(ctx) {
  wrapJsonRpcPrompt(HarnessSdkJsonRpcServer, function getAttachments() {
    return this.ctx?.get("attachments") || ctx.get("attachments");
  });
}
