import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { parseExcelBase64 } from "../../packages/import-core/src/readers.js";

const readerRequire = createRequire(new URL("../../packages/import-core/src/readers.js", import.meta.url));

test("Excel parsing uses the pinned fixed SheetJS release and reads a real workbook", async () => {
  const XLSX = readerRequire("xlsx");
  assert.equal(XLSX.version, "0.20.3");
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["MPN", "Qty"],
    ["NE555P", 10],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "BOM");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  assert.deepEqual(await parseExcelBase64(buffer.toString("base64")), [
    ["MPN", "Qty"],
    ["NE555P", "10"],
  ]);
});

test("SheetJS source is the official fixed tarball, not the stale npm registry release", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../../packages/import-core/package.json", import.meta.url), "utf8"));
  assert.equal(
    packageJson.optionalDependencies.xlsx,
    "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz",
  );
});
