/**
 * Full pipeline: Phase 1 (taxonomy) → Phase 2 (labeling)
 * Run: npm start
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { loadBookmarks } from "./load-bookmarks.js";
import { generateTaxonomyWithIteration, extendTaxonomy } from "./taxonomy.js";
import { labelAllBookmarks } from "./labeler.js";
import { parseTaxonomy } from "./validate.js";
import { CostTracker } from "./cost-tracker.js";
import { cli } from "./cli.js";
import type { Taxonomy } from "./types.js";

const OUTPUT_DIR = new URL("../output/", import.meta.url);
const TAXONOMY_PATH = new URL("../output/taxonomy.json", import.meta.url);
const ENRICHED_PATH = new URL("../output/enriched-bookmarks.json", import.meta.url);

async function main() {
  const startTime = Date.now();
  const costTracker = new CostTracker();

  cli.header("XSaved Topics");

  const bookmarks = loadBookmarks();
  cli.info(`Loaded ${bookmarks.length} bookmarks`);

  mkdirSync(OUTPUT_DIR, { recursive: true });

  // ── Phase 1: Taxonomy ──
  let taxonomy: Taxonomy;

  if (existsSync(TAXONOMY_PATH)) {
    cli.info(`Found existing taxonomy at ${TAXONOMY_PATH.pathname}`);
    const raw = readFileSync(TAXONOMY_PATH, "utf-8");
    const existing = parseTaxonomy(raw);

    if (!existing) {
      cli.error("Existing taxonomy.json is invalid. Delete it to regenerate.");
      process.exit(1);
    }

    cli.info(`${existing.length} top-level topics loaded`);
    taxonomy = await extendTaxonomy(existing, bookmarks, costTracker);
  } else {
    const result = await generateTaxonomyWithIteration(bookmarks, costTracker);

    if (!result.taxonomy) {
      cli.error("Taxonomy generation failed. Check logs above.");
      process.exit(1);
    }

    taxonomy = result.taxonomy;
    if (result.critique) {
      cli.success(`Final quality: ${result.critique.overallScore}/10 (${result.iterations} iteration${result.iterations !== 1 ? "s" : ""})`);
    }
  }

  writeFileSync(TAXONOMY_PATH, JSON.stringify(taxonomy, null, 2));
  cli.success(`Taxonomy saved → ${TAXONOMY_PATH.pathname}`);

  printTaxonomy(taxonomy);

  // ── Phase 2: Labeling ──
  const { enriched, rejectedIds, totalHallucinations } = await labelAllBookmarks(
    bookmarks,
    taxonomy,
    costTracker
  );

  writeFileSync(ENRICHED_PATH, JSON.stringify(enriched, null, 2));

  // ── Summary ──
  printSummary(enriched, bookmarks.length, rejectedIds, totalHallucinations, startTime, costTracker, taxonomy);
}

function printTaxonomy(taxonomy: Taxonomy) {
  cli.subheader("Generated Taxonomy");
  for (const topic of taxonomy) {
    const subCount = topic.subtopics?.length ?? 0;
    const subLabel = subCount > 0 ? ` (${subCount} subtopics)` : "";
    cli.success(`${topic.name}  [${topic.id}]${subLabel}`);
    for (const sub of topic.subtopics ?? []) {
      cli.info(`  └─ ${sub.name}  [${sub.id}]`);
    }
  }
}

function printSummary(
  enriched: { topics: string[] }[],
  totalBookmarks: number,
  rejectedIds: string[],
  totalHallucinations: number,
  startTime: number,
  costTracker: CostTracker,
  taxonomy: Taxonomy
) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const unclassified = enriched.filter((b) => b.topics.length === 0).length;
  const classified = enriched.length - unclassified;

  cli.header("Summary");
  cli.table([
    ["Time", `${elapsed}s`],
    ["Bookmarks", `${totalBookmarks}`],
    ["Classified", `${classified}`],
    ["Unclassified", `${unclassified}`],
    ["Rejected", `${rejectedIds.length}`],
    ["Hallucinations", `${totalHallucinations}`],
  ]);

  // Topic distribution
  const dist = new Map<string, number>();
  for (const b of enriched) {
    for (const t of b.topics) {
      dist.set(t, (dist.get(t) ?? 0) + 1);
    }
  }

  cli.subheader("Topic Distribution");
  const topicNames = new Map<string, string>();
  for (const topic of taxonomy) {
    topicNames.set(topic.id, topic.name);
    for (const sub of topic.subtopics ?? []) {
      topicNames.set(sub.id, `  └─ ${sub.name}`);
    }
  }

  const sorted = [...dist.entries()].sort((a, b) => b[1] - a[1]);
  const maxCount = sorted[0]?.[1] ?? 1;
  for (const [id, count] of sorted) {
    const barLen = Math.round((count / maxCount) * 15);
    const bar = "█".repeat(barLen) + "░".repeat(15 - barLen);
    const name = topicNames.get(id) ?? id;
    cli.info(`${bar} ${String(count).padStart(3)} ${name}`);
  }

  costTracker.printSummary();
}

main().catch((err) => {
  cli.error(`Fatal: ${err.message ?? err}`);
  process.exit(1);
});
