import test from "node:test";
import assert from "node:assert/strict";
import { admitPromptImages, encodedImageFromBlock, wrapJsonRpcPrompt } from "../../runtime/admit-images.js";

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("encoded image blocks are admitted into durable ImageAttachmentRef blocks", async () => {
  const saved = [];
  const attachments = {
    async saveImages(inputs) {
      saved.push(inputs);
      return inputs.map((input, index) => ({
        attachmentId: `sha256:test-${index}`,
        mediaType: input.mediaType,
        bytes: input.data.byteLength,
        width: 1,
        height: 1,
      }));
    },
    imageLimits: {
      maxImagesPerMessage: 20,
      maxMessageImageBytes: 8_000_000,
      mediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
    },
    async validateImage() {},
    async saveImage(input) {
      const [ref] = await this.saveImages([input]);
      return ref;
    },
  };

  const out = await admitPromptImages(attachments, [
    { type: "text", text: "read the attached image" },
    { type: "image", mediaType: "image/png", data: PNG_1X1 },
  ]);

  assert.equal(out[0].type, "text");
  assert.equal(out[1].type, "image");
  assert.equal(out[1].data, undefined);
  assert.equal(out[1].attachment.attachmentId, "sha256:test-0");
  assert.equal(out[1].attachment.mediaType, "image/png");
  assert.equal(saved.length, 1);
  assert.equal(encodedImageFromBlock(out[1]), null);
});

test("already-admitted image refs are left unchanged", async () => {
  const attachments = {
    async saveImages() {
      throw new Error("should not re-admit");
    },
  };
  const ref = {
    attachmentId: "sha256:existing",
    mediaType: "image/png",
    bytes: 80,
    width: 1,
    height: 1,
  };
  const out = await admitPromptImages(attachments, [{ type: "image", attachment: ref }]);
  assert.equal(out[0].attachment, ref);
});

test("encoded images without an attachment store fail instead of passing raw pixels", async () => {
  await assert.rejects(
    () =>
      admitPromptImages(null, [
        { type: "text", text: "look" },
        { type: "image", mediaType: "image/png", data: PNG_1X1 },
      ]),
    /attachment service/,
  );
});

test("JSON-RPC prompt wrapper admits encoded images before the original handler", async () => {
  class Server {
    constructor() {
      this.seen = null;
    }
    async prompt(params) {
      this.seen = params;
      return { messageId: "m1" };
    }
  }
  const attachments = {
    async saveImages(inputs) {
      return inputs.map((input, index) => ({
        attachmentId: `sha256:rpc-${index}`,
        mediaType: input.mediaType,
        bytes: input.data.byteLength,
        width: 1,
        height: 1,
      }));
    },
    imageLimits: {
      maxImagesPerMessage: 20,
      maxMessageImageBytes: 8_000_000,
      mediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
    },
    async validateImage() {},
    async saveImage(input) {
      const [ref] = await this.saveImages([input]);
      return ref;
    },
  };
  wrapJsonRpcPrompt(Server, () => attachments);
  const server = new Server();
  await server.prompt({
    sessionId: "s1",
    contentBlocks: [
      { type: "text", text: "read the attached image" },
      { type: "image", mediaType: "image/png", data: PNG_1X1 },
    ],
  });
  assert.equal(server.seen.contentBlocks[1].data, undefined);
  assert.equal(server.seen.contentBlocks[1].attachment.attachmentId, "sha256:rpc-0");
});
