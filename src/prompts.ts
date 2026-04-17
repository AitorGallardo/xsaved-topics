import type { BookmarkLite, Taxonomy } from "./types.js";

/**
 * Compact corpus view — short text + tags only.
 * Full bookmark text would bloat the Phase 1 prompt dramatically.
 * A 200-char snippet is enough signal for clustering.
 */
interface CorpusItem {
  t: string;  // text snippet (first 200 chars)
  a: string;  // author
  g?: string[]; // tags (if any)
  f?: string;  // folder name (if any)
}

function compactForCorpus(bookmark: BookmarkLite): CorpusItem {
  const item: CorpusItem = {
    t: bookmark.text.slice(0, 200),
    a: bookmark.author,
  };
  if (bookmark.tags.length > 0) item.g = bookmark.tags;
  if (bookmark.folder) item.f = bookmark.folder;
  return item;
}

/**
 * System prompt for Phase 1 — taxonomy generation.
 *
 * We ask Claude to:
 * - Find 5-8 top-level topics (narrow taxonomy, our design choice)
 * - Optionally add up to 3 subtopics per top-level
 * - Produce kebab-case ids that match the name
 * - Write descriptions that will anchor Phase 2 labeling
 */
export const TAXONOMY_SYSTEM_PROMPT = `You are an expert content curator who builds personalized topic taxonomies.

You will receive a user's bookmark collection. Your job is to analyze the full corpus, identify the natural clusters of interest, and produce a taxonomy that reflects how THIS user actually organizes their reading.

Output a JSON array of 5 to 8 top-level topics. Each topic has:
- "id": lowercase kebab-case, derived from the name (e.g. "ai-engineering", "startup-advice")
- "name": human-readable display name (e.g. "AI Engineering")
- "description": 1-2 sentences (20-300 chars) explaining what belongs in this topic. This description will be used to guide labeling, so be specific and actionable.
- "subtopics" (optional, max 3): array of { id, name, description } — same shape as topics but no further nesting

Rules:
- 5-8 top-level topics total — prefer the narrow end if the corpus is focused
- Look for REAL clusters: if 30% of bookmarks are about AI, that's a topic. If 1 bookmark mentions cooking, that's not a topic.
- Topic ids must be unique across the entire taxonomy (including subtopics)
- Descriptions must be concrete enough that someone reading ONLY the description could decide if a bookmark fits
- Avoid overlapping topics — "AI" and "Machine Learning" as separate top-level is bad; pick one
- Output ONLY the raw JSON array. No markdown fences, no prose, no explanation.`;

/**
 * Build the Phase 1 user prompt for a cold (first-time) taxonomy generation.
 *
 * If existing topic/folder names are provided, they're included as seed context —
 * Claude can see how the user already organizes their bookmarks and build on it.
 */
export function buildTaxonomyPrompt(
  bookmarks: BookmarkLite[],
  existingTopicNames?: string[]
): string {
  const corpus = bookmarks.map(compactForCorpus);

  let seedContext = "";
  if (existingTopicNames && existingTopicNames.length > 0) {
    seedContext = `\nThe user has already manually created these topic/folder categories: ${existingTopicNames.join(", ")}. Use these as signals for what matters to this user — you may adopt, merge, or rename them, but don't ignore them.\n`;
  }

  // Extract unique folder names from the corpus
  const folders = [...new Set(bookmarks.map((b) => b.folder).filter(Boolean))];
  let folderContext = "";
  if (folders.length > 0) {
    folderContext = `\nThe user's existing folders: ${folders.join(", ")}. These represent how the user groups bookmarks today — factor them into your taxonomy.\n`;
  }

  return `Analyze this collection of ${bookmarks.length} bookmarks and produce a personalized taxonomy:
${seedContext}${folderContext}
${JSON.stringify(corpus)}`;
}

/**
 * Build the Phase 1 user prompt for incremental extension.
 *
 * When new bookmarks arrive, we show Claude the existing taxonomy and
 * the new bookmarks, and ask whether any new topics should be added.
 * Existing topic ids must be preserved.
 */
export function buildExtensionPrompt(
  existingTaxonomy: Taxonomy,
  newBookmarks: BookmarkLite[]
): string {
  const corpus = newBookmarks.map(compactForCorpus);
  return `Here is the user's existing taxonomy:

${JSON.stringify(existingTaxonomy)}

Here are ${newBookmarks.length} new bookmarks they've added:

${JSON.stringify(corpus)}

Return an updated taxonomy that follows these rules:
- PRESERVE every existing topic id, name, and description exactly unless a rename would genuinely improve clarity (prefer preservation)
- If the new bookmarks fit existing topics, return the taxonomy unchanged
- If they reveal a genuine new cluster (multiple bookmarks around a theme not covered), add a new top-level topic or subtopic
- Total top-level topics must stay within 5-8 after any additions
- Output ONLY the raw JSON array.`;
}

/**
 * System prompt for Phase 2 — labeling a batch of bookmarks against the taxonomy.
 *
 * We give Claude the whole taxonomy (with descriptions) in the user prompt
 * and ask it to assign 1-5 topic ids per bookmark from the provided set only.
 * Every id returned MUST exist in the taxonomy — descriptions are the anchor.
 */
export const LABELING_SYSTEM_PROMPT = `You are a content classifier. For each bookmark, you assign the most fitting topic ids from a provided taxonomy.

Rules:
- For each bookmark, return a JSON object with { "id": <bookmark id>, "topics": <array of 0-5 topic ids> }
- Topic ids MUST come from the provided taxonomy. Use the exact id strings. Never invent or modify ids.
- Prefer the most specific topic: if a subtopic fits, use it instead of the parent top-level topic
- Assign 1-3 topic ids for typical bookmarks. Use 4-5 only when the content genuinely spans multiple distinct themes.
- If a bookmark truly does not fit any topic in the taxonomy (very rare — only for highly ambiguous or off-topic content), return an EMPTY topics array. Do not force a bad fit.
- Use the topic "description" field as your guide — the name alone may not be specific enough
- Return a JSON array with one result per bookmark, same order as input
- Output ONLY the raw JSON array. No markdown fences, no commentary.`;

/**
 * Build the user prompt for a labeling batch.
 */
export function buildLabelingPrompt(
  taxonomy: Taxonomy,
  bookmarks: BookmarkLite[]
): string {
  const compactCorpus = bookmarks.map(compactForCorpus).map((c, i) => ({
    id: bookmarks[i].id,
    ...c,
  }));
  return `Taxonomy to label against:

${JSON.stringify(taxonomy)}

Bookmarks to label (${bookmarks.length}):

${JSON.stringify(compactCorpus)}`;
}

/**
 * System prompt for the taxonomy critique (LLM-as-judge).
 *
 * We ask Claude to evaluate a proposed taxonomy across 5 dimensions and
 * return a structured score + concrete issues + suggestions. The output
 * drives the decision to accept or regenerate.
 */
export const CRITIQUE_SYSTEM_PROMPT = `You are a rigorous taxonomy reviewer. You evaluate proposed topic taxonomies against the bookmark corpus they're meant to classify.

Score the taxonomy on five dimensions, each 1-10:
- "coverage": do the topics cover what's in the corpus? Orphan themes with multiple bookmarks unreflected in the taxonomy = low score.
- "granularity": are topics at a useful zoom level? Too broad (one topic catches half the corpus) or too narrow (a topic for 2 bookmarks) = low score.
- "overlap": are topics semantically distinct? Redundant topics ("AI" + "Machine Learning" as separate) = low score. High score means no overlap.
- "naming": are topic names specific and descriptions actionable enough for a labeler to decide fit? Vague or generic = low score.
- "balance": will the taxonomy produce a reasonable distribution when labels are applied, or will one topic dominate / several be empty?

Output ONLY a JSON object with this exact shape:
{
  "dimensions": {
    "coverage": <int 1-10>,
    "granularity": <int 1-10>,
    "overlap": <int 1-10>,
    "naming": <int 1-10>,
    "balance": <int 1-10>
  },
  "overallScore": <int 1-10, your overall quality judgment>,
  "issues": [<concrete problem strings, max 5>],
  "suggestions": [<concrete fix strings aimed at a NEXT regeneration attempt, max 5>]
}

Be strict. A 7 means "good, ship it." A 5 means "usable but meaningfully flawed." Below 5 means the taxonomy has real problems.`;

/**
 * Build the user prompt for critiquing a taxonomy.
 * We send a sample of the corpus (not all of it) to keep the call cheap.
 */
export function buildCritiquePrompt(
  taxonomy: Taxonomy,
  corpusSample: BookmarkLite[]
): string {
  const sample = corpusSample.map(compactForCorpus);
  return `Here is the proposed taxonomy:

${JSON.stringify(taxonomy)}

Here is a sample of ${corpusSample.length} bookmarks from the corpus:

${JSON.stringify(sample)}

Evaluate the taxonomy. Output the JSON critique only.`;
}

/**
 * Build a regeneration prompt that includes feedback from a previous critique.
 * The model now has both the failed attempt and concrete reasons to improve it.
 */
export function buildRegenerationPrompt(
  bookmarks: BookmarkLite[],
  previousAttempt: Taxonomy,
  previousScore: number,
  issues: string[],
  suggestions: string[]
): string {
  const corpus = bookmarks.map(compactForCorpus);
  return `Your previous taxonomy attempt scored ${previousScore}/10 and had these problems:

Issues:
${issues.map((i) => `- ${i}`).join("\n")}

Suggestions from the reviewer:
${suggestions.map((s) => `- ${s}`).join("\n")}

Previous attempt (for reference — do not simply return it unchanged):
${JSON.stringify(previousAttempt)}

Produce a new taxonomy for this corpus that addresses the issues above:

${JSON.stringify(corpus)}`;
}
