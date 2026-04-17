/**
 * Full pipeline: Phase 1 (taxonomy) → Phase 2 (labeling) → Phase 3 (audit)
 * Run: npm start
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { loadBookmarks, loadExistingTopicNames } from "./load-bookmarks.js";
import { generateTaxonomyWithIteration, extendTaxonomy } from "./taxonomy.js";
import { labelAllBookmarks } from "./labeler.js";
import { auditLabeling, type AuditResult } from "./audit.js";
import { printTaxonomyDiff } from "./taxonomy-diff.js";
import { parseTaxonomy } from "./validate.js";
import { CostTracker } from "./cost-tracker.js";
import { appendRunLog } from "./run-log.js";
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
  let taxonomyScore: number | null = null;
  let taxonomyIterations = 1;

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

    printTaxonomyDiff(existing, taxonomy);
  } else {
    const threshold = parseInt(process.env.TAXONOMY_THRESHOLD ?? "7", 10);
    const existingTopicNames = loadExistingTopicNames();
    if (existingTopicNames.length > 0) {
      cli.info(`Found ${existingTopicNames.length} existing user topics as seed context`);
    }

    const result = await generateTaxonomyWithIteration(bookmarks, costTracker, {
      acceptanceThreshold: threshold,
      existingTopicNames,
    });

    if (!result.taxonomy) {
      cli.error("Taxonomy generation failed. Check logs above.");
      process.exit(1);
    }

    taxonomy = result.taxonomy;
    taxonomyScore = result.critique?.overallScore ?? null;
    taxonomyIterations = result.iterations;

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
  cli.success(`Output saved → ${ENRICHED_PATH.pathname}`);

  // ── Phase 3: Audit ──
  const audit = await auditLabeling(enriched, taxonomy, costTracker);

  // ── Summary ──
  const elapsed = (Date.now() - startTime) / 1000;
  printSummary(enriched, bookmarks.length, rejectedIds, totalHallucinations, elapsed, costTracker, taxonomy, audit);

  // ── Run Log ──
  const unclassified = enriched.filter((b) => b.topics.length === 0).length;
  appendRunLog({
    timestamp: new Date().toISOString(),
    bookmarks: bookmarks.length,
    classified: enriched.length - unclassified,
    unclassified,
    rejected: rejectedIds.length,
    hallucinations: totalHallucinations,
    taxonomyScore,
    taxonomyIterations,
    topicCount: taxonomy.length,
    totalCost: costTracker.totalCost,
    elapsedSeconds: Math.round(elapsed),
    auditAccuracy: audit?.accuracy ?? null,
  });
  cli.info("Run log appended to output/run-log.json");
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
  elapsedSeconds: number,
  costTracker: CostTracker,
  taxonomy: Taxonomy,
  audit: AuditResult | null
) {
  const unclassified = enriched.filter((b) => b.topics.length === 0).length;
  const classified = enriched.length - unclassified;

  cli.header("Summary");
  const rows: [string, string][] = [
    ["Time", `${elapsedSeconds.toFixed(1)}s`],
    ["Bookmarks", `${totalBookmarks}`],
    ["Classified", `${classified}`],
    ["Unclassified", `${unclassified}`],
    ["Rejected", `${rejectedIds.length}`],
    ["Hallucinations", `${totalHallucinations}`],
  ];
  if (audit) {
    rows.push(["Audit accuracy", `${audit.accuracy}%`]);
  }
  cli.table(rows);

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
