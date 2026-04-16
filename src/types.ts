/**
 * The full bookmark shape as it exists in bookmarks.json.
 * We only type the fields we care about — the rest we ignore.
 */
export interface RawBookmark {
  id: string;
  text: string;
  author: string;
  avatar_url: string;
  created_at: string;
  bookmarked_at: string;
  tags: string[];
  notes?: string;
  folderId?: string;
  media: unknown[];
}

/**
 * The lightweight version we send to Claude.
 *
 * We strip heavy fields (avatar_url, media blobs) to minimize token cost.
 * We keep `mediaTypes` as a flat string[] so Claude has context about
 * media presence without the nested URLs/metadata.
 */
export interface BookmarkLite {
  id: string;
  text: string;
  author: string;
  created_at: string;
  bookmarked_at: string;
  tags: string[];
  notes?: string;
  mediaTypes?: string[];
}

/**
 * A topic in the taxonomy.
 *
 * - `id` is kebab-case, stable across runs (e.g. "ai-engineering")
 * - `name` is the display label (e.g. "AI Engineering")
 * - `description` anchors Phase 2 labeling — with it, Claude has a
 *   consistent reference instead of re-guessing from the name each time
 * - `subtopics` is optional and capped at 1 level deep (no grandchildren)
 */
export interface Topic {
  id: string;
  name: string;
  description: string;
  subtopics?: SubTopic[];
}

/**
 * A subtopic has the same shape as a topic but cannot have its own subtopics.
 * Enforcing this at the type level prevents accidental deeper nesting.
 */
export interface SubTopic {
  id: string;
  name: string;
  description: string;
}

/**
 * A taxonomy is an ordered list of top-level topics.
 */
export type Taxonomy = Topic[];

/**
 * The result Claude returns for a single bookmark during labeling.
 * `topics` contains topic ids that must exist in the taxonomy.
 */
export interface LabelingResult {
  id: string;
  topics: string[];
}

/**
 * Structured output of the LLM-as-judge taxonomy critique.
 * Used by the iteration loop to decide whether to accept or regenerate.
 */
export interface TaxonomyCritique {
  dimensions: {
    coverage: number;
    granularity: number;
    overlap: number;
    naming: number;
    balance: number;
  };
  overallScore: number;
  issues: string[];
  suggestions: string[];
}

/**
 * A bookmark with topic labels added.
 */
export interface EnrichedBookmark extends BookmarkLite {
  topics: string[];
}
