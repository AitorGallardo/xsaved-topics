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
  description: z.string().min(20).max(300),
});

/**
 * Schema for a top-level topic — may contain up to 3 subtopics.
 */
const TopicSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]+$/, "id must be lowercase kebab-case (letters, digits, dashes)"),
  name: z.string().min(1).max(50),
  description: z.string().min(20).max(300),
  subtopics: z.array(SubTopicSchema).max(3).optional(),
});

/**
 * A taxonomy is between 5 and 8 top-level topics (our design decision: narrow).
 */
export const TaxonomySchema = z.array(TopicSchema).min(5).max(8);

/**
 * Schema for one bookmark's labeling result.
 * Topic count bounds: 0-5 per bookmark.
 *
 * Empty topics means "unclassified" — a legitimate outcome when a bookmark
 * doesn't fit any topic in the taxonomy well (e.g., a very short/ambiguous
 * tweet). Forcing Claude to guess would produce worse data than accepting
 * no label. The labeler tracks unclassified counts separately.
 */
const LabelingResultSchema = z.object({
  id: z.string(),
  topics: z.array(z.string()).max(5),
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
 * Result of parsing a labeling batch.
 * `clean` contains results where every topic id is valid.
 * `partial` contains results where at least one valid topic remained after
 *   stripping hallucinated ids (the result was partially usable).
 * `rejected` contains results where ALL topic ids were hallucinated (unrecoverable).
 * `hallucinations` is the flat list of invalid topic ids found, for logging.
 */
export interface LabelingParseResult {
  clean: LabelingResult[];
  partial: LabelingResult[];
  rejected: string[]; // bookmark ids that couldn't be labeled at all
  hallucinations: string[];
}

/**
 * Parse Claude's raw text response into validated batch labeling results.
 *
 * Two-stage validation:
 * 1. Zod checks shape (array of { id, topics: string[] } with bounded length)
 * 2. Runtime check filters topic ids against the current taxonomy
 *
 * Unlike Phase 1 (all-or-nothing), Phase 2 returns partial results. If Claude
 * labels 14/15 bookmarks correctly and hallucinates one id, we keep the 14
 * good ones. The batch retry can then target only the rejected bookmarks.
 *
 * Returns null only if the shape is structurally broken (JSON parse or Zod fail).
 */
export function parseLabelingBatch(
  raw: string,
  taxonomy: Taxonomy
): LabelingParseResult | null {
  try {
    const json = JSON.parse(stripFences(raw));
    const results = LabelingBatchSchema.parse(json);

    const validIds = collectTopicIds(taxonomy);
    const clean: LabelingResult[] = [];
    const partial: LabelingResult[] = [];
    const rejected: string[] = [];
    const hallucinations: string[] = [];

    for (const result of results) {
      const validTopics: string[] = [];
      const invalidTopics: string[] = [];

      for (const topicId of result.topics) {
        if (validIds.has(topicId)) validTopics.push(topicId);
        else invalidTopics.push(topicId);
      }

      for (const bad of invalidTopics) {
        hallucinations.push(`${result.id} → "${bad}"`);
      }

      if (invalidTopics.length === 0) {
        clean.push(result);
      } else if (validTopics.length > 0) {
        partial.push({ id: result.id, topics: validTopics });
      } else {
        rejected.push(result.id);
      }
    }

    return { clean, partial, rejected, hallucinations };
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.warn(
        "Labeling shape validation failed:",
        error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      );
    } else if (error instanceof SyntaxError) {
      console.warn("Labeling JSON parse failed:", error.message);
    }
    return null;
  }
}
