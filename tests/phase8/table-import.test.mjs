import test from "node:test";
import assert from "node:assert/strict";
import { createModelRouter } from "../../packages/model-policy/src/index.js";
import { productionFixture } from "../../packages/model-policy/src/fixture.js";
import { createRuntime, importAgentInput } from "../../apps/agent-api/src/runtime.js";

function tableRuntime(officialRunAgent) {
  return createRuntime({
    env: { ELECTRONICS_HARNESS_STUB: "" },
    harnessAvailable: true,
    router: createModelRouter({ registry: productionFixture() }),
    officialRunAgent,
  });
}

test("table mapping sends only a bounded preview to the Agent and bulk-applies its mapping", async () => {
  const csv = [
    "操作说明：价格和客户单号不要发给模型",
    "Requested p/n,Requested quantity,Quoted p/n,Quoted quantity,Quoted Manufacturer,DC,Lead time weeks",
    "JCT1655SJ,4500,JCT1655SJ,450,JieJie,2615+,2",
    "BC817-25LT1G,3000,BC817-25LT1G,3000,onsemi,26+,6",
  ].join("\n");
  const runtime = tableRuntime(async (job) => {
    assert.equal(job.kind, "import");
    assert.equal(job.input.fileBase64, undefined);
    assert.equal(job.input.text, undefined);
    assert.deepEqual(job.input.preview.header.slice(0, 2), ["Requested p/n", "Requested quantity"]);
    assert.equal(job.input.preview.sample.length, 2);
    return {
      ok: true,
      mapping: {
        columns: [
          { header: "Quoted p/n", target: "mpn" },
          { header: "Quoted quantity", target: "qty" },
          { header: "Quoted Manufacturer", target: "brand" },
          { header: "DC", target: "dateCode" },
          { header: "Lead time weeks", target: "lt" },
        ],
      },
      usedAi: true,
      viaHarness: true,
      toolsCalled: ["import_validate_mapping"],
    };
  });

  const out = await runtime.runImport({
    kind: "offer",
    sourceType: "csv",
    text: csv,
    mode: "agent",
  });
  assert.equal(out.ok, true);
  assert.equal(out.viaHarness, true);
  assert.equal(out.usedAi, true);
  assert.deepEqual(out.toolsCalled, ["import_validate_mapping"]);
  assert.equal(out.candidates.length, 2);
  assert.equal(out.candidates[0].mpn, "JCT1655SJ");
  assert.equal(out.candidates[0].qty, 450);
  assert.equal(out.candidates[0].dateCode, "2615+");
  assert.equal(out.candidates[1].leadTimeText, "6");
});

test("table mapping prompt never embeds file bytes or asks the model to relay them", () => {
  const sentinel = "SENSITIVE_BASE64_BYTES_SHOULD_NOT_ENTER_THE_PROMPT";
  const prompt = importAgentInput({
    kind: "offer",
    sourceType: "excel",
    filename: "quote.xlsx",
    preview: {
      header: ["Quoted p/n", "Quoted quantity"],
      sample: [["TPS54560DDAR", "10000"]],
      headerIndex: 1,
    },
    fileBase64: sentinel,
  });
  assert.equal(typeof prompt, "string");
  assert.doesNotMatch(prompt, new RegExp(sentinel));
  assert.match(prompt, /import_validate_mapping/);
  assert.doesNotMatch(prompt, /import_table_preview|import_apply_mapping/);
});
