/**
 * CLI entry point — tags all bookmarks and writes the enriched output.
 * Run: npm start
 */
import { mkdirSync, writeFileSync } from "fs";
import { loadBookmarks } from "./load-bookmarks.js";
import { tagAllBookmarks } from "./tagger.js";

const OUTPUT_DIR = new URL("../output/", import.meta.url);
const OUTPUT_FILE = new URL("../output/enriched-bookmarks.json", import.meta.url);

async function main() {
  const startTime = Date.now();

  const bookmarks = loadBookmarks();
  console.log(`Loaded ${bookmarks.length} bookmarks`);

  const { enriched, failedCount, costTracker } = await tagAllBookmarks(bookmarks);

  // Write output
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_FILE, JSON.stringify(enriched, null, 2));

  // Final summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Done in ${elapsed}s`);
  console.log(`  Enriched: ${enriched.length}/${bookmarks.length}`);
  if (failedCount > 0) {
    console.log(`  Failed:   ${failedCount}`);
  }
  costTracker.printSummary();
  console.log(`\n  Output: ${OUTPUT_FILE.pathname}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
