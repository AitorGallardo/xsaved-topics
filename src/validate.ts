import { z } from "zod";
import type { LabelingResult, Taxonomy, TaxonomyCritique } from "./types.js";

/**
 * Schema for a subtopic — cannot have further subtopics.
 * Enforcing this at the schema level prevents deeper nesting even if
 * Claude tries to produce it.
 */
const SubTopicSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]+$/, "id must be lowercase kebab-case (letters, digits, dashes)"),
  name: z.string().min(1).max(50),
  description: z.string().min(20).max(240),
});

/**
 * Schema for a top-level topic — may contain up to 3 subtopics.
 */
const TopicSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]+$/, "id must be lowercase kebab-case (letters, digits, dashes)"),
  name: z.string().min(1).max(50),
  description: z.string().min(20).max(240),
  subtopics: z.array(SubTopicSchema).max(3).optional(),
});

/**
 * A taxonomy is between 5 and 8 top-level topics (our design decision: narrow).
 */
export const TaxonomySchema = z.array(TopicSchema).min(5).max(8);

/**
 * Schema for one bookmark's labeling result.
 * Topic count bounds: 1-5 per bookmark.
 */
const LabelingResultSchema = z.object({
  id: z.string(),
  topics: z.array(z.string()).min(1).max(5),
});

export const LabelingBatchSchema = z.array(LabelingResultSchema);

/**
 * Schema for the LLM-as-judge critique output.
 * Each dimension is 1-10; issues and suggestions are bounded to keep output concise.
 */
const scoreField = z.number().int().min(1).max(10);

export const TaxonomyCritiqueSchema = z.object({
  dimensions: z.object({
    coverage: scoreField,
    granularity: scoreField,
    overlap: scoreField,
    naming: scoreField,
    balance: scoreField,
  }),
  overallScore: scoreField,
  issues: z.array(z.string()).max(5),
  suggestions: z.array(z.string()).max(5),
});

/**
 * Parse Claude's raw text response into a validated critique.
 */
export function parseCritique(raw: string): TaxonomyCritique | null {
  try {
    const json = JSON.parse(stripFences(raw));
    return TaxonomyCritiqueSchema.parse(json);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.warn(
        "Critique validation failed:",
        error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      );
    } else if (error instanceof SyntaxError) {
      console.warn("Critique JSON parse failed:", error.message);
    }
    return null;
  }
}

/**
 * Strip markdown code fences if Claude wraps the JSON output in them.
 */
function stripFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "");
}

/**
 * Parse Claude's raw text response into a validated Taxonomy.
 * Returns null if parsing or validation fails.
 */
export function parseTaxonomy(raw: string): Taxonomy | null {
  try {
    const json = JSON.parse(stripFences(raw));
    return TaxonomySchema.parse(json);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.warn(
        "Taxonomy validation failed:",
        error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      );
    } else if (error instanceof SyntaxError) {
      console.warn("Taxonomy JSON parse failed:", error.message);
    }
    return null;
  }
}

/**
 * Collect every topic id from a taxonomy, including subtopic ids.
 * Used to validate that labeled topic ids actually exist.
 */
export function collectTopicIds(taxonomy: Taxonomy): Set<string> {
  const ids = new Set<string>();
  for (const topic of taxonomy) {
    ids.add(topic.id);
    for (const sub of topic.subtopics ?? []) {
      ids.add(sub.id);
    }
  }
  return ids;
}

/**
 * Parse Claude's raw text response into a validated batch of labeling results.
 *
 * Two-stage validation:
 * 1. Zod checks shape (array of { id, topics: string[] } with bounded length)
 * 2. Custom check verifies each topic id exists in the taxonomy — this
 *    catches hallucinated ids that Zod can't know about
 *
 * Returns null if any stage fails.
 */
export function parseLabelingBatch(
  raw: string,
  taxonomy: Taxonomy
): LabelingResult[] | null {
  try {
    const json = JSON.parse(stripFences(raw));
    const results = LabelingBatchSchema.parse(json);

    const validIds = collectTopicIds(taxonomy);
    const hallucinated: string[] = [];

    for (const result of results) {
      for (const topicId of result.topics) {
        if (!validIds.has(topicId)) {
          hallucinated.push(`${result.id} → "${topicId}"`);
        }
      }
    }

    if (hallucinated.length > 0) {
      console.warn(
        `Hallucinated topic ids: ${hallucinated.slice(0, 3).join(", ")}${hallucinated.length > 3 ? "..." : ""}`
      );
      return null;
    }

    return results;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.warn(
        "Labeling validation failed:",
        error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      );
    } else if (error instanceof SyntaxError) {
      console.warn("Labeling JSON parse failed:", error.message);
    }
    return null;
  }
}
