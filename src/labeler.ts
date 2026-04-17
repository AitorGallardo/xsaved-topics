import { anthropic } from "./claude-client.js";
import { LABELING_SYSTEM_PROMPT, buildLabelingPrompt } from "./prompts.js";
import { parseLabelingBatch } from "./validate.js";
import { CostTracker } from "./cost-tracker.js";
import { cli } from "./cli.js";
import type {
  BookmarkLite,
  Taxonomy,
  LabelingResult,
  EnrichedBookmark,
} from "./types.js";

const LABELING_MODEL = "claude-haiku-4-5-20251001";
const BATCH_SIZE = 15;
const MAX_RETRIES = 2;

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

interface BatchStats {
  clean: number;
  unclassified: number;
  partial: number;
  rejected: number;
  hallucinations: string[];
}

async function processBatch(
  batch: BookmarkLite[],
  taxonomy: Taxonomy,
  batchIndex: number,
  totalBatches: number,
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

    cli.spin(`Labeling batch ${batchIndex + 1}/${totalBatches}...`);

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
      cli.stop();
      if (attempt <= MAX_RETRIES) {
        cli.warn(`Batch ${batchIndex + 1} attempt ${attempt}: shape failed. Retrying...`);
      } else {
        cli.error(`Batch ${batchIndex + 1}: shape failed after ${MAX_RETRIES + 1} attempts. Dropping ${remaining.length} bookmarks.`);
      }
      continue;
    }

    for (const r of parsed.clean) collected.set(r.id, r);
    for (const r of parsed.partial) collected.set(r.id, r);
    stats.hallucinations.push(...parsed.hallucinations);

    const rejectedIds = new Set(parsed.rejected);
    remaining = remaining.filter((b) => rejectedIds.has(b.id));

    if (remaining.length > 0 && attempt <= MAX_RETRIES) {
      cli.stop();
      cli.warn(`Batch ${batchIndex + 1}: ${remaining.length} rejected. Retrying those only...`);
    }
  }

  cli.stop();

  const results = Array.from(collected.values());
  for (const r of results) {
    const hadInvalid = stats.hallucinations.some((h) => h.startsWith(`${r.id} →`));
    if (hadInvalid) stats.partial++;
    else if (r.topics.length === 0) stats.unclassified++;
    else stats.clean++;
  }
  stats.rejected = remaining.length;

  return { results, stats };
}

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

  cli.header("Phase 2: Labeling");
  cli.info(`Model: ${LABELING_MODEL} | ${bookmarks.length} bookmarks in ${batches.length} batches`);
  cli.blank();

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const { results, stats } = await processBatch(batch, taxonomy, i, batches.length, costTracker);

    for (const r of results) allResults.set(r.id, r);
    rejectedIds.push(...batch.filter((b) => !allResults.has(b.id)).map((b) => b.id));
    totalHallucinations += stats.hallucinations.length;

    const parts: string[] = [`${stats.clean} clean`];
    if (stats.unclassified) parts.push(`${stats.unclassified} unclassified`);
    if (stats.partial) parts.push(`${stats.partial} partial`);
    if (stats.rejected) parts.push(`${stats.rejected} rejected`);

    cli.progress(i + 1, batches.length, parts.join(", "));
  }

  const enriched: EnrichedBookmark[] = [];
  for (const bookmark of bookmarks) {
    const result = allResults.get(bookmark.id);
    if (result) {
      enriched.push({ ...bookmark, topics: result.topics });
    }
  }

  return { enriched, rejectedIds, totalHallucinations };
}
