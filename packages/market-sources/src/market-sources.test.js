import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { parseHqewOffers, parseLcscSearchItemUrl } from "./md-parse.js";
import { scrapeMarkdown } from "./firecrawl.js";
import { runLookupStep } from "./lookup.js";
import { icnetAuthOrParse } from "./icnet.js";
import { assessParseHealth } from "./health.js";

test("package has no Harness or business-path coupling", () => {
  const req = createRequire(import.meta.url);
  const pkg = req("../package.json");
  assert.equal(pkg.dependencies, undefined);
  const src = req("node:fs").readFileSync(new URL("./firecrawl.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /let requestKey\s*=/);
  assert.doesNotMatch(src, /["']\/workspace\//);
  assert.doesNotMatch(src, /TodoApp-Mac/);
});

test("hqew markdown parser is a pure function", () => {
  const md = `
| 供应商 | 型号 | 品牌 | 批号 | 数量 | 封装 | 仓库 | 交易说明 | 日期 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 老陈电子 | TPS54560DDAR | TI | 2418 | 10000 | HSOP | 香港 | ￥8.2 | 08-24 |
`;
  const rows = parseHqewOffers(md);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].model, "TPS54560DDAR");
  assert.equal(rows[0].stock, 10000);
});

test("concurrent scrapes do not share keys", async () => {
  const seen = [];
  const fakeFetch = async (_url, init) => {
    seen.push(init.headers.Authorization);
    return {
      ok: true,
      async json() {
        return { success: true, data: { markdown: "# ok" } };
      },
    };
  };
  await Promise.all([
    scrapeMarkdown("https://example.com/a", { firecrawlKey: "key-A", fetch: fakeFetch }),
    scrapeMarkdown("https://example.com/b", { firecrawlKey: "key-B", fetch: fakeFetch }),
  ]);
  assert.deepEqual(seen.sort(), ["Bearer key-A", "Bearer key-B"].sort());
});

test("caller abort signal reaches outbound connectors", async () => {
  const controller = new AbortController();
  const fakeFetch = (_url, init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  });
  const pending = scrapeMarkdown("https://example.com/slow", {
    firecrawlKey: "request-key",
    fetch: fakeFetch,
    signal: controller.signal,
  });
  controller.abort(new Error("caller_cancelled"));
  await assert.rejects(pending, /caller_cancelled/);
});

test("missing firecrawl key fails that request only", async () => {
  const r = await runLookupStep({ query: "NE555P", step: "hqew" }, {});
  assert.equal(r.ok, false);
  assert.match(r.error, /firecrawlKey/);
});

test("icnet without cookie is auth_required, not a file probe", () => {
  const r = icnetAuthOrParse("", "NE555P", {});
  assert.equal(r.status, "auth_required");
  assert.match(r.detail, /ctx.icnetCookie/);
});

test("empty structured offers are unhealthy", () => {
  const h = assessParseHealth("hqew", []);
  assert.equal(h.healthy, false);
});

test("lcsc search url parser", () => {
  const url = parseLcscSearchItemUrl(
    "[NE555P](https://item.szlcsc.com/123.html)",
    "NE555P",
  );
  assert.equal(url, "https://item.szlcsc.com/123.html");
});
