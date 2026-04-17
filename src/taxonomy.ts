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
import { cli } from "./cli.js";
import type { BookmarkLite, Taxonomy, TaxonomyCritique } from "./types.js";

const TAXONOMY_MODEL = "claude-sonnet-4-6";
const MAX_PARSE_RETRIES = 2;

const DEFAULT_MAX_ITERATIONS = 2;
const DEFAULT_ACCEPTANCE_THRESHOLD = 7;
const DEFAULT_CRITIQUE_SAMPLE_SIZE = 40;

export async function generateTaxonomy(
  bookmarks: BookmarkLite[],
  costTracker: CostTracker,
  prompt?: string,
  existingTopicNames?: string[]
): Promise<Taxonomy | null> {
  const userPrompt = prompt ?? buildTaxonomyPrompt(bookmarks, existingTopicNames);

  for (let attempt = 1; attempt <= MAX_PARSE_RETRIES + 1; attempt++) {
    cli.spin("Generating taxonomy...");
    const response = await anthropic.messages.create({
      model: TAXONOMY_MODEL,
      max_tokens: 3000,
      system: TAXONOMY_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    costTracker.addUsage(TAXONOMY_MODEL, response.usage.input_tokens, response.usage.output_tokens);

    const raw = response.content[0].type === "text" ? response.content[0].text : "";
    const taxonomy = parseTaxonomy(raw);

    if (taxonomy) {
      cli.stop();
      return taxonomy;
    }

    cli.stop();
    if (attempt <= MAX_PARSE_RETRIES) {
      cli.warn(`Parse attempt ${attempt} invalid. Retrying...`);
    }
  }

  return null;
}

export async function critiqueTaxonomy(
  taxonomy: Taxonomy,
  bookmarks: BookmarkLite[],
  costTracker: CostTracker,
  sampleSize: number = DEFAULT_CRITIQUE_SAMPLE_SIZE
): Promise<TaxonomyCritique | null> {
  const sample = sampleBookmarks(bookmarks, sampleSize);

  for (let attempt = 1; attempt <= MAX_PARSE_RETRIES + 1; attempt++) {
    cli.spin("Critiquing taxonomy...");
    const response = await anthropic.messages.create({
      model: TAXONOMY_MODEL,
      max_tokens: 1000,
      system: CRITIQUE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildCritiquePrompt(taxonomy, sample) }],
    });

    costTracker.addUsage(TAXONOMY_MODEL, response.usage.input_tokens, response.usage.output_tokens);

    const raw = response.content[0].type === "text" ? response.content[0].text : "";
    const critique = parseCritique(raw);

    if (critique) {
      cli.stop();
      return critique;
    }

    cli.stop();
    if (attempt <= MAX_PARSE_RETRIES) {
      cli.warn(`Critique parse attempt ${attempt} invalid. Retrying...`);
    }
  }

  return null;
}

export interface IterationOptions {
  maxIterations?: number;
  acceptanceThreshold?: number;
  sampleSize?: number;
  existingTopicNames?: string[];
}

export async function generateTaxonomyWithIteration(
  bookmarks: BookmarkLite[],
  costTracker: CostTracker,
  options: IterationOptions = {}
): Promise<{ taxonomy: Taxonomy | null; critique: TaxonomyCritique | null; iterations: number }> {
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const threshold = options.acceptanceThreshold ?? DEFAULT_ACCEPTANCE_THRESHOLD;
  const sampleSize = options.sampleSize ?? DEFAULT_CRITIQUE_SAMPLE_SIZE;

  cli.header("Phase 1: Taxonomy Generation");
  cli.info(`Model: ${TAXONOMY_MODEL} | Threshold: ${threshold}/10 | Max iterations: ${maxIterations + 1}`);

  let bestTaxonomy: Taxonomy | null = null;
  let bestCritique: TaxonomyCritique | null = null;
  let bestScore = -1;

  for (let iteration = 0; iteration <= maxIterations; iteration++) {
    const attemptLabel = iteration === 0 ? "Initial generation" : `Iteration ${iteration}`;
    cli.subheader(`[${attemptLabel}]`);

    let candidate: Taxonomy | null;
    if (iteration === 0 || !bestTaxonomy || !bestCritique) {
      candidate = await generateTaxonomy(bookmarks, costTracker, undefined, options.existingTopicNames);
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
      cli.error("Generation failed — stopping iteration");
      break;
    }

    cli.success(`Generated ${candidate.length} top-level topics`);

    const critique = await critiqueTaxonomy(candidate, bookmarks, costTracker, sampleSize);
    if (!critique) {
      cli.warn("Critique failed — accepting candidate as-is");
      return { taxonomy: candidate, critique: null, iterations: iteration + 1 };
    }

    printCritique(critique);

    if (critique.overallScore > bestScore) {
      bestTaxonomy = candidate;
      bestCritique = critique;
      bestScore = critique.overallScore;
    }

    if (critique.overallScore >= threshold) {
      cli.success(`Score ${critique.overallScore}/10 meets threshold — accepted`);
      return { taxonomy: candidate, critique, iterations: iteration + 1 };
    }

    if (iteration < maxIterations) {
      cli.warn(`Score ${critique.overallScore}/10 below threshold — regenerating with feedback`);
    }
  }

  cli.warn(`No candidate hit threshold. Returning best seen (score ${bestScore}/10).`);
  return { taxonomy: bestTaxonomy, critique: bestCritique, iterations: maxIterations + 1 };
}

export async function extendTaxonomy(
  existingTaxonomy: Taxonomy,
  newBookmarks: BookmarkLite[],
  costTracker: CostTracker
): Promise<Taxonomy> {
  if (newBookmarks.length === 0) return existingTaxonomy;

  cli.header("Phase 1: Extending Taxonomy");
  cli.info(`${newBookmarks.length} new bookmarks to evaluate`);

  const extensionPrompt = buildExtensionPrompt(existingTaxonomy, newBookmarks);
  const updated = await generateTaxonomy(newBookmarks, costTracker, extensionPrompt);

  if (updated) {
    const added = updated.length - existingTaxonomy.length;
    cli.success(`Extension complete (${added >= 0 ? "+" : ""}${added} top-level topics)`);
    return updated;
  }

  cli.warn("Extension failed — falling back to existing taxonomy");
  return existingTaxonomy;
}

function sampleBookmarks(bookmarks: BookmarkLite[], size: number): BookmarkLite[] {
  if (bookmarks.length <= size) return bookmarks;
  const shuffled = [...bookmarks].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, size);
}

function printCritique(critique: TaxonomyCritique): void {
  const d = critique.dimensions;
  cli.table([
    ["coverage", `${d.coverage}/10`],
    ["granularity", `${d.granularity}/10`],
    ["overlap", `${d.overlap}/10`],
    ["naming", `${d.naming}/10`],
    ["balance", `${d.balance}/10`],
    ["overall", `${critique.overallScore}/10`],
  ]);
  if (critique.issues.length > 0) {
    for (const issue of critique.issues) cli.warn(issue);
  }
}
