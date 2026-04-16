import { anthropic } from "./claude-client.js";
import {
  TAXONOMY_SYSTEM_PROMPT,
  CRITIQUE_SYSTEM_PROMPT,
  buildTaxonomyPrompt,
  buildExtensionPrompt,
  buildCritiquePrompt,
  buildRegenerationPrompt,
} from "./prompts.js";
import { parseTaxonomy, parseCritique } from "./validate.js";
import { CostTracker } from "./cost-tracker.js";
import type { BookmarkLite, Taxonomy, TaxonomyCritique } from "./types.js";

const TAXONOMY_MODEL = "claude-sonnet-4-6";
const MAX_PARSE_RETRIES = 2;

// Iteration defaults — overridable via options
const DEFAULT_MAX_ITERATIONS = 2;
const DEFAULT_ACCEPTANCE_THRESHOLD = 7;
const DEFAULT_CRITIQUE_SAMPLE_SIZE = 40;

/**
 * Low-level: single-shot taxonomy generation.
 *
 * Retries only on parse/schema failures — no semantic quality check.
 * The iteration wrapper (below) handles quality.
 */
export async function generateTaxonomy(
  bookmarks: BookmarkLite[],
  costTracker: CostTracker,
  prompt?: string
): Promise<Taxonomy | null> {
  const userPrompt = prompt ?? buildTaxonomyPrompt(bookmarks);

  for (let attempt = 1; attempt <= MAX_PARSE_RETRIES + 1; attempt++) {
    const response = await anthropic.messages.create({
      model: TAXONOMY_MODEL,
      max_tokens: 3000,
      system: TAXONOMY_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    costTracker.addUsage(TAXONOMY_MODEL, response.usage.input_tokens, response.usage.output_tokens);

    const raw = response.content[0].type === "text" ? response.content[0].text : "";
    const taxonomy = parseTaxonomy(raw);

    if (taxonomy) return taxonomy;

    if (attempt <= MAX_PARSE_RETRIES) {
      console.warn(`  ⚠ Parse attempt ${attempt} invalid. Retrying...`);
    }
  }

  return null;
}

/**
 * Critique a taxonomy against a corpus sample using LLM-as-judge.
 *
 * We send only a sample (not the full corpus) to keep the critique call
 * cheap. The sample is random so recurring calls get different views.
 */
export async function critiqueTaxonomy(
  taxonomy: Taxonomy,
  bookmarks: BookmarkLite[],
  costTracker: CostTracker,
  sampleSize: number = DEFAULT_CRITIQUE_SAMPLE_SIZE
): Promise<TaxonomyCritique | null> {
  const sample = sampleBookmarks(bookmarks, sampleSize);

  for (let attempt = 1; attempt <= MAX_PARSE_RETRIES + 1; attempt++) {
    const response = await anthropic.messages.create({
      model: TAXONOMY_MODEL,
      max_tokens: 1000,
      system: CRITIQUE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildCritiquePrompt(taxonomy, sample) }],
    });

    costTracker.addUsage(TAXONOMY_MODEL, response.usage.input_tokens, response.usage.output_tokens);

    const raw = response.content[0].type === "text" ? response.content[0].text : "";
    const critique = parseCritique(raw);

    if (critique) return critique;

    if (attempt <= MAX_PARSE_RETRIES) {
      console.warn(`  ⚠ Critique parse attempt ${attempt} invalid. Retrying...`);
    }
  }

  return null;
}

interface IterationOptions {
  maxIterations?: number;
  acceptanceThreshold?: number;
  sampleSize?: number;
}

/**
 * Production-grade taxonomy generation with self-critique iteration.
 *
 * Flow:
 *   1. Generate candidate taxonomy
 *   2. Critique it (LLM-as-judge)
 *   3. If score >= threshold → accept
 *   4. Else if iterations remaining → regenerate with critique feedback
 *   5. Always return the best candidate seen, even if none hit threshold
 *
 * Bounded cost: maxIterations regenerations, each with one critique.
 */
export async function generateTaxonomyWithIteration(
  bookmarks: BookmarkLite[],
  costTracker: CostTracker,
  options: IterationOptions = {}
): Promise<{ taxonomy: Taxonomy | null; critique: TaxonomyCritique | null; iterations: number }> {
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const threshold = options.acceptanceThreshold ?? DEFAULT_ACCEPTANCE_THRESHOLD;
  const sampleSize = options.sampleSize ?? DEFAULT_CRITIQUE_SAMPLE_SIZE;

  console.log(
    `\nPhase 1: Generating taxonomy with iteration (max ${maxIterations + 1} attempts, threshold ${threshold}/10)`
  );

  let bestTaxonomy: Taxonomy | null = null;
  let bestCritique: TaxonomyCritique | null = null;
  let bestScore = -1;

  for (let iteration = 0; iteration <= maxIterations; iteration++) {
    const attemptLabel = iteration === 0 ? "Initial generation" : `Iteration ${iteration}`;
    console.log(`\n  [${attemptLabel}]`);

    // Generate — either cold or informed by previous critique
    let candidate: Taxonomy | null;
    if (iteration === 0 || !bestTaxonomy || !bestCritique) {
      candidate = await generateTaxonomy(bookmarks, costTracker);
    } else {
      const regenPrompt = buildRegenerationPrompt(
        bookmarks,
        bestTaxonomy,
        bestScore,
        bestCritique.issues,
        bestCritique.suggestions
      );
      candidate = await generateTaxonomy(bookmarks, costTracker, regenPrompt);
    }

    if (!candidate) {
      console.warn(`    Generation failed — stopping iteration`);
      break;
    }

    console.log(`    ✓ Generated ${candidate.length} top-level topics`);

    // Critique
    const critique = await critiqueTaxonomy(candidate, bookmarks, costTracker, sampleSize);
    if (!critique) {
      console.warn(`    Critique failed — accepting candidate as-is`);
      return { taxonomy: candidate, critique: null, iterations: iteration + 1 };
    }

    printCritique(critique);

    // Track best seen
    if (critique.overallScore > bestScore) {
      bestTaxonomy = candidate;
      bestCritique = critique;
      bestScore = critique.overallScore;
    }

    // Accept if above threshold
    if (critique.overallScore >= threshold) {
      console.log(`    ✓ Score ${critique.overallScore}/10 meets threshold ${threshold}/10 — accepting`);
      return { taxonomy: candidate, critique, iterations: iteration + 1 };
    }

    if (iteration < maxIterations) {
      console.log(`    Score ${critique.overallScore}/10 below threshold — regenerating with feedback`);
    }
  }

  console.warn(
    `\n  No candidate hit threshold. Returning best seen (score ${bestScore}/10).`
  );
  return { taxonomy: bestTaxonomy, critique: bestCritique, iterations: maxIterations + 1 };
}

/**
 * Extend an existing taxonomy with new bookmarks (incremental mode).
 * No iteration loop here — extensions are minor adjustments, not full rewrites.
 */
export async function extendTaxonomy(
  existingTaxonomy: Taxonomy,
  newBookmarks: BookmarkLite[],
  costTracker: CostTracker
): Promise<Taxonomy> {
  if (newBookmarks.length === 0) return existingTaxonomy;

  console.log(
    `\nPhase 1 (incremental): Extending taxonomy with ${newBookmarks.length} new bookmarks`
  );

  const extensionPrompt = buildExtensionPrompt(existingTaxonomy, newBookmarks);
  const updated = await generateTaxonomy(newBookmarks, costTracker, extensionPrompt);

  if (updated) {
    const added = updated.length - existingTaxonomy.length;
    console.log(`  ✓ Extension complete (${added >= 0 ? "+" : ""}${added} top-level topics)`);
    return updated;
  }

  console.warn(`  ✗ Extension failed — falling back to existing taxonomy`);
  return existingTaxonomy;
}

/* ─── helpers ─────────────────────────────────────────────────── */

function sampleBookmarks(bookmarks: BookmarkLite[], size: number): BookmarkLite[] {
  if (bookmarks.length <= size) return bookmarks;
  const shuffled = [...bookmarks].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, size);
}

function printCritique(critique: TaxonomyCritique): void {
  const d = critique.dimensions;
  console.log(
    `    Scores: coverage=${d.coverage} granularity=${d.granularity} overlap=${d.overlap} naming=${d.naming} balance=${d.balance} → overall ${critique.overallScore}/10`
  );
  if (critique.issues.length > 0) {
    console.log(`    Issues:`);
    for (const issue of critique.issues) console.log(`      - ${issue}`);
  }
}
