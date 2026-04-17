import { anthropic } from "./claude-client.js";
import { CostTracker } from "./cost-tracker.js";
import { cli } from "./cli.js";
import type { EnrichedBookmark, Taxonomy } from "./types.js";
import { z } from "zod";

const AUDIT_MODEL = "claude-sonnet-4-6";
const AUDIT_SAMPLE_SIZE = 15;

const AuditResultSchema = z.object({
  correct: z.number().int().min(0),
  incorrect: z.number().int().min(0),
  accuracy: z.number().min(0).max(100),
  issues: z.array(
    z.object({
      bookmarkId: z.string(),
      problem: z.string(),
      suggestedTopics: z.array(z.string()),
    })
  ),
});

export type AuditResult = z.infer<typeof AuditResultSchema>;

const AUDIT_SYSTEM_PROMPT = `You are a quality auditor for a bookmark labeling system. You verify whether bookmarks were assigned to the correct topics.

For each bookmark, check if the assigned topics make sense given the bookmark text and the topic descriptions.

Return a JSON object:
{
  "correct": <number of correctly labeled bookmarks>,
  "incorrect": <number of incorrectly labeled bookmarks>,
  "accuracy": <percentage 0-100>,
  "issues": [
    { "bookmarkId": "<id>", "problem": "<what's wrong>", "suggestedTopics": ["<better-topic-id>", ...] }
  ]
}

Only flag genuinely wrong assignments. A bookmark in a broad-but-acceptable topic is fine.
Return ONLY the raw JSON object.`;

export async function auditLabeling(
  enriched: EnrichedBookmark[],
  taxonomy: Taxonomy,
  costTracker: CostTracker
): Promise<AuditResult | null> {
  const classified = enriched.filter((b) => b.topics.length > 0);
  if (classified.length === 0) return null;

  // Sample classified bookmarks only
  const shuffled = [...classified].sort(() => Math.random() - 0.5);
  const sample = shuffled.slice(0, AUDIT_SAMPLE_SIZE);

  cli.header("Phase 3: Labeling Audit");
  cli.info(`Auditing ${sample.length} randomly sampled bookmarks (using ${AUDIT_MODEL})`);

  const auditData = sample.map((b) => ({
    id: b.id,
    text: b.text.slice(0, 200),
    author: b.author,
    assignedTopics: b.topics,
  }));

  cli.spin("Running labeling quality check...");

  const response = await anthropic.messages.create({
    model: AUDIT_MODEL,
    max_tokens: 1500,
    system: AUDIT_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Taxonomy:\n${JSON.stringify(taxonomy)}\n\nLabeled bookmarks to audit:\n${JSON.stringify(auditData)}`,
      },
    ],
  });

  costTracker.addUsage(AUDIT_MODEL, response.usage.input_tokens, response.usage.output_tokens);
  cli.stop();

  const raw = response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "");

  try {
    const result = AuditResultSchema.parse(JSON.parse(cleaned));
    cli.success(`Accuracy: ${result.accuracy}% (${result.correct}/${result.correct + result.incorrect} correct)`);

    if (result.issues.length > 0) {
      cli.subheader("Mislabeled bookmarks:");
      for (const issue of result.issues) {
        cli.warn(`${issue.bookmarkId}: ${issue.problem}`);
        cli.info(`  Suggested: ${issue.suggestedTopics.join(", ")}`);
      }
    }

    return result;
  } catch {
    cli.warn("Audit response failed validation — skipping");
    return null;
  }
}
