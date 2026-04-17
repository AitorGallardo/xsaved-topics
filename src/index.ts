/**
 * CLI entry point.
 *
 * First run:       generates taxonomy → labels all bookmarks → writes both files
 * Incremental run: loads existing taxonomy → extends if needed → labels → writes
 *
 * Run: npm start
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { loadBookmarks } from "./load-bookmarks.js";
import { generateTaxonomyWithIteration, extendTaxonomy } from "./taxonomy.js";
import { labelAllBookmarks } from "./labeler.js";
import { parseTaxonomy } from "./validate.js";
import { CostTracker } from "./cost-tracker.js";
import type { Taxonomy } from "./types.js";

const OUTPUT_DIR = new URL("../output/", import.meta.url);
const TAXONOMY_PATH = new URL("../output/taxonomy.json", import.meta.url);
const ENRICHED_PATH = new URL("../output/enriched-bookmarks.json", import.meta.url);

async function main() {
  const startTime = Date.now();
  const costTracker = new CostTracker();

  // Load bookmarks
  const bookmarks = loadBookmarks();
  console.log(`Loaded ${bookmarks.length} bookmarks`);

  // Ensure output directory exists
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // Phase 1: Taxonomy — generate or extend
  let taxonomy: Taxonomy;
  const existingTaxonomyPath = TAXONOMY_PATH;

  if (existsSync(existingTaxonomyPath)) {
    console.log(`\nFound existing taxonomy at ${existingTaxonomyPath.pathname}`);
    const raw = readFileSync(existingTaxonomyPath, "utf-8");
    const existing = parseTaxonomy(raw);

    if (!existing) {
      console.error("Existing taxonomy.json is invalid. Delete it to regenerate.");
      process.exit(1);
    }

    console.log(`  ${existing.length} top-level topics loaded`);
    taxonomy = await extendTaxonomy(existing, bookmarks, costTracker);
  } else {
    console.log(`\nNo existing taxonomy found — generating from scratch`);
    const result = await generateTaxonomyWithIteration(bookmarks, costTracker);

    if (!result.taxonomy) {
      console.error("\nTaxonomy generation failed. Check logs above.");
      process.exit(1);
    }

    taxonomy = result.taxonomy;
    if (result.critique) {
      console.log(`  Final quality score: ${result.critique.overallScore}/10`);
    }
  }

  // Write taxonomy
  writeFileSync(TAXONOMY_PATH, JSON.stringify(taxonomy, null, 2));
  console.log(`\nTaxonomy written to ${TAXONOMY_PATH.pathname}`);

  // Print taxonomy summary
  console.log(`\n--- Taxonomy ---`);
  for (const topic of taxonomy) {
    const subCount = topic.subtopics?.length ?? 0;
    const subLabel = subCount > 0 ? ` (${subCount} subtopics)` : "";
    console.log(`  ${topic.name}  [${topic.id}]${subLabel}`);
  }

  // Phase 2: Labeling
  const { enriched, rejectedIds, totalHallucinations } = await labelAllBookmarks(
    bookmarks,
    taxonomy,
    costTracker
  );

  // Write enriched bookmarks
  writeFileSync(ENRICHED_PATH, JSON.stringify(enriched, null, 2));

  // Final summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const unclassified = enriched.filter((b) => b.topics.length === 0).length;

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Done in ${elapsed}s`);
  console.log(`  Labeled:        ${enriched.length}/${bookmarks.length}`);
  if (unclassified > 0) console.log(`  Unclassified:   ${unclassified}`);
  if (rejectedIds.length > 0) console.log(`  Rejected:       ${rejectedIds.length}`);
  if (totalHallucinations > 0) console.log(`  Hallucinations: ${totalHallucinations}`);
  costTracker.printSummary();
  console.log(`\n  Taxonomy: ${TAXONOMY_PATH.pathname}`);
  console.log(`  Output:   ${ENRICHED_PATH.pathname}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
