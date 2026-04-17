import { anthropic } from "./claude-client.js";
import { LABELING_SYSTEM_PROMPT, buildLabelingPrompt } from "./prompts.js";
import { parseLabelingBatch } from "./validate.js";
import { CostTracker } from "./cost-tracker.js";
import type {
  BookmarkLite,
  Taxonomy,
  LabelingResult,
  EnrichedBookmark,
} from "./types.js";

const LABELING_MODEL = "claude-haiku-4-5-20251001";
const BATCH_SIZE = 15;
const MAX_RETRIES = 2;

/**
 * Split an array into chunks of the given size.
 */
function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

interface BatchStats {
  clean: number;         // fully valid result with at least 1 topic
  unclassified: number;  // valid result with empty topics (deliberately unlabeled)
  partial: number;       // had some hallucinated ids, we kept the valid ones
  rejected: number;      // couldn't label at all after all retries
  hallucinations: string[];
}

/**
 * Process a single batch with retry.
 * On each attempt, we call Claude, validate, and track partial progress.
 * If a result is rejected (all topic ids hallucinated), it gets retried
 * along with any shape-failed bookmarks. Clean and partial results are
 * kept across attempts — we don't redo work that already succeeded.
 */
async function processBatch(
  batch: BookmarkLite[],
  taxonomy: Taxonomy,
  batchIndex: number,
  costTracker: CostTracker
): Promise<{ results: LabelingResult[]; stats: BatchStats }> {
  const collected = new Map<string, LabelingResult>();
  let remaining = batch;
  const stats: BatchStats = {
    clean: 0,
    unclassified: 0,
    partial: 0,
    rejected: 0,
    hallucinations: [],
  };

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    if (remaining.length === 0) break;

    const response = await anthropic.messages.create({
      model: LABELING_MODEL,
      max_tokens: 2048,
      system: LABELING_SYSTEM_PROMPT,
      messages: [
        { role: "user", content: buildLabelingPrompt(taxonomy, remaining) },
        { role: "assistant", content: "[" },
      ],
    });

    costTracker.addUsage(LABELING_MODEL, response.usage.input_tokens, response.usage.output_tokens);

    const raw = "[" + (response.content[0].type === "text" ? response.content[0].text : "");
    const parsed = parseLabelingBatch(raw, taxonomy);

    if (!parsed) {
      // Structural failure (shape/JSON) — retry the whole remaining set
      if (attempt <= MAX_RETRIES) {
        console.warn(`  ⚠ Batch ${batchIndex + 1} attempt ${attempt}: shape failed. Retrying...`);
      } else {
        console.error(
          `  ✗ Batch ${batchIndex + 1}: shape failed after ${MAX_RETRIES + 1} attempts. Dropping ${remaining.length} bookmarks.`
        );
      }
      continue;
    }

    // Collect clean + partial results (they're valid enough to keep)
    for (const r of parsed.clean) collected.set(r.id, r);
    for (const r of parsed.partial) collected.set(r.id, r);
    stats.hallucinations.push(...parsed.hallucinations);

    // Only rejected ids need to be retried
    const rejectedIds = new Set(parsed.rejected);
    remaining = remaining.filter((b) => rejectedIds.has(b.id));

    if (remaining.length > 0 && attempt <= MAX_RETRIES) {
      console.warn(
        `  ⚠ Batch ${batchIndex + 1} attempt ${attempt}: ${remaining.length} rejected. Retrying those only...`
      );
    }
  }

  // Finalize stats
  const results = Array.from(collected.values());
  for (const r of results) {
    const hadInvalid = stats.hallucinations.some((h) => h.startsWith(`${r.id} →`));
    if (hadInvalid) stats.partial++;
    else if (r.topics.length === 0) stats.unclassified++;
    else stats.clean++;
  }
  stats.rejected = remaining.length; // whatever's left after all retries

  return { results, stats };
}

/**
 * Label all bookmarks against the taxonomy.
 * Returns enriched bookmarks + a summary of what succeeded and what didn't.
 */
export async function labelAllBookmarks(
  bookmarks: BookmarkLite[],
  taxonomy: Taxonomy,
  costTracker: CostTracker
): Promise<{
  enriched: EnrichedBookmark[];
  rejectedIds: string[];
  totalHallucinations: number;
}> {
  const batches = chunk(bookmarks, BATCH_SIZE);
  const allResults = new Map<string, LabelingResult>();
  const rejectedIds: string[] = [];
  let totalHallucinations = 0;

  console.log(
    `\nPhase 2: Labeling ${bookmarks.length} bookmarks in ${batches.length} batches of ~${BATCH_SIZE} (using ${LABELING_MODEL})\n`
  );

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`  Batch ${i + 1}/${batches.length} (${batch.length} bookmarks)...`);

    const { results, stats } = await processBatch(batch, taxonomy, i, costTracker);

    for (const r of results) allResults.set(r.id, r);
    rejectedIds.push(...batch.filter((b) => !allResults.has(b.id)).map((b) => b.id));
    totalHallucinations += stats.hallucinations.length;

    const parts: string[] = [];
    if (stats.clean) parts.push(`${stats.clean} clean`);
    if (stats.unclassified) parts.push(`${stats.unclassified} unclassified`);
    if (stats.partial) parts.push(`${stats.partial} partial`);
    if (stats.rejected) parts.push(`${stats.rejected} rejected`);
    console.log(`    ✓ ${parts.join(", ")}`);
  }

  // Merge results with original bookmarks
  const enriched: EnrichedBookmark[] = [];
  for (const bookmark of bookmarks) {
    const result = allResults.get(bookmark.id);
    if (result) {
      enriched.push({ ...bookmark, topics: result.topics });
    }
  }

  return { enriched, rejectedIds, totalHallucinations };
}
