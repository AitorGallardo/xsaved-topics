import { anthropic } from "./claude-client.js";
import { SYSTEM_PROMPT, buildBatchPrompt } from "./prompts.js";
import { parseBatchResult } from "./validate.js";
import { CostTracker } from "./cost-tracker.js";
import type { BookmarkLite, TagResult, EnrichedBookmark } from "./types.js";

const MODEL = "claude-haiku-4-5-20251001";
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

/**
 * Process a single batch: send bookmarks to Claude, validate the response.
 * Records token usage in the cost tracker (including failed attempts).
 */
async function processBatch(
  batch: BookmarkLite[],
  batchIndex: number,
  costTracker: CostTracker
): Promise<TagResult[]> {
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [
          { role: "user", content: buildBatchPrompt(batch) },
          { role: "assistant", content: "[" },
        ],
      });

      // Track cost for every call — including retries
      costTracker.addUsage(response.usage.input_tokens, response.usage.output_tokens);

      const raw = "[" + (response.content[0].type === "text" ? response.content[0].text : "");
      const results = parseBatchResult(raw);

      if (!results) {
        throw new Error("Validation failed");
      }

      if (results.length !== batch.length) {
        console.warn(
          `  ⚠ Batch ${batchIndex + 1}: expected ${batch.length} results, got ${results.length}`
        );
      }

      return results;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (attempt <= MAX_RETRIES) {
        console.warn(`  ⚠ Batch ${batchIndex + 1} attempt ${attempt} failed: ${msg}. Retrying...`);
      } else {
        console.error(`  ✗ Batch ${batchIndex + 1} failed after ${MAX_RETRIES + 1} attempts: ${msg}`);
        return [];
      }
    }
  }

  return [];
}

/**
 * Merge Claude's tag results back into the bookmark data.
 */
function enrichBookmark(bookmark: BookmarkLite, result: TagResult): EnrichedBookmark {
  return {
    ...bookmark,
    aiTags: result.tags,
    aiSummary: result.summary,
    aiContentType: result.contentType,
    aiSentiment: result.sentiment,
  };
}

/**
 * Process all bookmarks in batches and return enriched results + cost summary.
 */
export async function tagAllBookmarks(
  bookmarks: BookmarkLite[]
): Promise<{
  enriched: EnrichedBookmark[];
  failedCount: number;
  costTracker: CostTracker;
}> {
  const batches = chunk(bookmarks, BATCH_SIZE);
  const allResults = new Map<string, TagResult>();
  const costTracker = new CostTracker(MODEL);

  console.log(`\nProcessing ${bookmarks.length} bookmarks in ${batches.length} batches of ~${BATCH_SIZE}\n`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`  Batch ${i + 1}/${batches.length} (${batch.length} bookmarks)...`);

    const results = await processBatch(batch, i, costTracker);

    for (const r of results) {
      allResults.set(r.id, r);
    }

    console.log(`    ✓ ${results.length} results`);
  }

  // Match results back to bookmarks
  const enriched: EnrichedBookmark[] = [];
  let failedCount = 0;

  for (const bookmark of bookmarks) {
    const result = allResults.get(bookmark.id);
    if (result) {
      enriched.push(enrichBookmark(bookmark, result));
    } else {
      failedCount++;
    }
  }

  return { enriched, failedCount, costTracker };
}
