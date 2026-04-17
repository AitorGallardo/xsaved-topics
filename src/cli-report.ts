/**
 * Generate a coverage report from existing output files.
 * Run: npm run report
 *
 * Reads taxonomy.json and enriched-bookmarks.json and prints:
 * - Topic distribution with visual bars
 * - Unclassified bookmark list
 * - Top authors per topic
 */
import { existsSync, readFileSync } from "fs";
import { parseTaxonomy } from "./validate.js";
import { cli } from "./cli.js";
import type { EnrichedBookmark, Taxonomy } from "./types.js";

const TAXONOMY_PATH = new URL("../output/taxonomy.json", import.meta.url);
const ENRICHED_PATH = new URL("../output/enriched-bookmarks.json", import.meta.url);

function main() {
  if (!existsSync(ENRICHED_PATH) || !existsSync(TAXONOMY_PATH)) {
    cli.error("No output files found. Run `npm start` first.");
    process.exit(1);
  }

  const taxonomy: Taxonomy = JSON.parse(readFileSync(TAXONOMY_PATH, "utf-8"));
  const enriched: EnrichedBookmark[] = JSON.parse(readFileSync(ENRICHED_PATH, "utf-8"));

  cli.header("XSaved Topics — Coverage Report");

  // ── Distribution ──
  const dist = new Map<string, EnrichedBookmark[]>();
  for (const b of enriched) {
    for (const t of b.topics) {
      if (!dist.has(t)) dist.set(t, []);
      dist.get(t)!.push(b);
    }
  }

  const topicNames = new Map<string, string>();
  for (const topic of taxonomy) {
    topicNames.set(topic.id, topic.name);
    for (const sub of topic.subtopics ?? []) {
      topicNames.set(sub.id, `  └─ ${sub.name}`);
    }
  }

  cli.subheader("Topic Distribution");
  const sorted = [...dist.entries()].sort((a, b) => b[1].length - a[1].length);
  const maxCount = sorted[0]?.[1]?.length ?? 1;

  for (const [id, bookmarks] of sorted) {
    const barLen = Math.round((bookmarks.length / maxCount) * 20);
    const bar = "█".repeat(barLen) + "░".repeat(20 - barLen);
    const name = topicNames.get(id) ?? id;
    cli.info(`${bar} ${String(bookmarks.length).padStart(3)} ${name}`);
  }

  // ── Top authors per topic ──
  cli.subheader("Top Authors per Topic");
  for (const topic of taxonomy) {
    const ids = [topic.id, ...(topic.subtopics ?? []).map((s) => s.id)];
    const authors = new Map<string, number>();
    for (const id of ids) {
      for (const b of dist.get(id) ?? []) {
        authors.set(b.author, (authors.get(b.author) ?? 0) + 1);
      }
    }
    const topAuthors = [...authors.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([a, c]) => `@${a} (${c})`)
      .join(", ");
    if (topAuthors) {
      cli.info(`${topic.name}: ${topAuthors}`);
    }
  }

  // ── Unclassified ──
  const unclassified = enriched.filter((b) => b.topics.length === 0);
  if (unclassified.length > 0) {
    cli.subheader(`Unclassified Bookmarks (${unclassified.length})`);
    for (const b of unclassified) {
      const text = b.text.slice(0, 80) || "(empty)";
      cli.warn(`@${b.author}: ${text}${b.text.length > 80 ? "..." : ""}`);
    }
  }

  // ── Overall stats ──
  const classified = enriched.length - unclassified.length;
  cli.subheader("Summary");
  cli.table([
    ["Total bookmarks", `${enriched.length}`],
    ["Classified", `${classified} (${Math.round((classified / enriched.length) * 100)}%)`],
    ["Unclassified", `${unclassified.length}`],
    ["Topics used", `${dist.size}`],
    ["Unique authors", `${new Set(enriched.map((b) => b.author)).size}`],
  ]);
}

main();
