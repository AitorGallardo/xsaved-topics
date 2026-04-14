import { z } from "zod";
import type { TagResult } from "./types.js";

/**
 * Schema for a single bookmark's tag result.
 * Now includes `id` so we can match results back to bookmarks in batch mode.
 */
export const TagResultSchema = z.object({
  id: z.string(),
  tags: z
    .array(z.string().toLowerCase())
    .min(2)
    .max(5),
  summary: z.string().max(200),
  contentType: z.enum([
    "opinion",
    "advice",
    "news",
    "humor",
    "resource",
    "discussion",
    "inspiration",
  ]),
  sentiment: z.enum(["positive", "negative", "neutral", "mixed"]),
});

/**
 * Schema for a batch response — an array of tag results.
 */
export const BatchResultSchema = z.array(TagResultSchema);

/**
 * Parse Claude's raw text response into a validated array of TagResults.
 *
 * Handles:
 * 1. Markdown fences — Claude sometimes wraps JSON in ```json blocks
 * 2. Invalid JSON — parse errors from malformed output
 * 3. Schema mismatch — valid JSON but wrong shape
 *
 * Returns the validated results or null if anything fails.
 */
export function parseBatchResult(raw: string): TagResult[] | null {
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "");

    const json = JSON.parse(cleaned);
    return BatchResultSchema.parse(json);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.warn("Validation failed:", error.issues.map((i) => `${i.path}: ${i.message}`).join(", "));
    } else if (error instanceof SyntaxError) {
      console.warn("JSON parse failed:", error.message);
    }
    return null;
  }
}
