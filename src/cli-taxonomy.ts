/**
 * Phase 1 only: generate or extend taxonomy.
 * Run: npm run taxonomy
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { loadBookmarks } from "./load-bookmarks.js";
import { generateTaxonomyWithIteration, extendTaxonomy } from "./taxonomy.js";
import { parseTaxonomy } from "./validate.js";
import { CostTracker } from "./cost-tracker.js";
import { cli } from "./cli.js";

const OUTPUT_DIR = new URL("../output/", import.meta.url);
const TAXONOMY_PATH = new URL("../output/taxonomy.json", import.meta.url);

async function main() {
  const costTracker = new CostTracker();

  cli.header("XSaved Topics — Taxonomy Only");

  const bookmarks = loadBookmarks();
  cli.info(`Loaded ${bookmarks.length} bookmarks`);

  mkdirSync(OUTPUT_DIR, { recursive: true });

  if (existsSync(TAXONOMY_PATH)) {
    cli.info("Found existing taxonomy — extending");
    const raw = readFileSync(TAXONOMY_PATH, "utf-8");
    const existing = parseTaxonomy(raw);

    if (!existing) {
      cli.error("Existing taxonomy.json is invalid. Delete it to regenerate.");
      process.exit(1);
    }

    const updated = await extendTaxonomy(existing, bookmarks, costTracker);
    writeFileSync(TAXONOMY_PATH, JSON.stringify(updated, null, 2));
  } else {
    cli.info("No existing taxonomy — generating from scratch");
    const result = await generateTaxonomyWithIteration(bookmarks, costTracker);

    if (!result.taxonomy) {
      cli.error("Taxonomy generation failed.");
      process.exit(1);
    }

    writeFileSync(TAXONOMY_PATH, JSON.stringify(result.taxonomy, null, 2));

    cli.subheader("Generated Taxonomy");
    for (const topic of result.taxonomy) {
      const subCount = topic.subtopics?.length ?? 0;
      cli.success(`${topic.name}  [${topic.id}]${subCount > 0 ? ` (${subCount} subtopics)` : ""}`);
    }

    if (result.critique) {
      cli.info(`Quality: ${result.critique.overallScore}/10 in ${result.iterations} iteration(s)`);
    }
  }

  cli.success(`Taxonomy saved → ${TAXONOMY_PATH.pathname}`);
  costTracker.printSummary();
}

main().catch((err) => {
  cli.error(`Fatal: ${err.message ?? err}`);
  process.exit(1);
});
