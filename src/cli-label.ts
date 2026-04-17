/**
 * Phase 2 only: label bookmarks against existing taxonomy.
 * Requires taxonomy.json to already exist (run `npm run taxonomy` first).
 * Run: npm run label
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { loadBookmarks } from "./load-bookmarks.js";
import { labelAllBookmarks } from "./labeler.js";
import { parseTaxonomy } from "./validate.js";
import { CostTracker } from "./cost-tracker.js";
import { cli } from "./cli.js";

const TAXONOMY_PATH = new URL("../output/taxonomy.json", import.meta.url);
const ENRICHED_PATH = new URL("../output/enriched-bookmarks.json", import.meta.url);

async function main() {
  const costTracker = new CostTracker();

  cli.header("XSaved Topics — Labeling Only");

  if (!existsSync(TAXONOMY_PATH)) {
    cli.error("No taxonomy.json found. Run `npm run taxonomy` or `npm start` first.");
    process.exit(1);
  }

  const raw = readFileSync(TAXONOMY_PATH, "utf-8");
  const taxonomy = parseTaxonomy(raw);
  if (!taxonomy) {
    cli.error("taxonomy.json is invalid. Delete it and regenerate.");
    process.exit(1);
  }

  cli.info(`Taxonomy loaded: ${taxonomy.length} top-level topics`);

  const bookmarks = loadBookmarks();
  cli.info(`Loaded ${bookmarks.length} bookmarks`);

  const { enriched, rejectedIds, totalHallucinations } = await labelAllBookmarks(
    bookmarks,
    taxonomy,
    costTracker
  );

  writeFileSync(ENRICHED_PATH, JSON.stringify(enriched, null, 2));

  const unclassified = enriched.filter((b) => b.topics.length === 0).length;

  cli.header("Results");
  cli.table([
    ["Classified", `${enriched.length - unclassified}`],
    ["Unclassified", `${unclassified}`],
    ["Rejected", `${rejectedIds.length}`],
    ["Hallucinations", `${totalHallucinations}`],
  ]);

  cli.success(`Output saved → ${ENRICHED_PATH.pathname}`);
  costTracker.printSummary();
}

main().catch((err) => {
  cli.error(`Fatal: ${err.message ?? err}`);
  process.exit(1);
});
