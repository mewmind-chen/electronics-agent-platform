/**
 * Load live qualification rows. Missing file → empty (all stay candidate).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function liveResultsPath() {
  return join(dirname(fileURLToPath(import.meta.url)), "../../../tests/phase82/live-results.json");
}

export function loadLiveResults(path = liveResultsPath()) {
  if (process.env.ELECTRONICS_IGNORE_LIVE === "1") return [];
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(raw.results) ? raw.results : [];
  } catch {
    return [];
  }
}
