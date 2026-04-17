import { cli } from "./cli.js";
import type { Taxonomy } from "./types.js";
import { collectTopicIds } from "./validate.js";

/**
 * Show what changed between two taxonomy versions.
 * Used after incremental extension to surface additions/removals.
 */
export function printTaxonomyDiff(before: Taxonomy, after: Taxonomy): void {
  const beforeIds = collectTopicIds(before);
  const afterIds = collectTopicIds(after);

  const added = [...afterIds].filter((id) => !beforeIds.has(id));
  const removed = [...beforeIds].filter((id) => !afterIds.has(id));

  if (added.length === 0 && removed.length === 0) {
    cli.info("Taxonomy unchanged — existing topics cover the new bookmarks");
    return;
  }

  cli.subheader("Taxonomy Changes");

  if (added.length > 0) {
    for (const id of added) {
      const topic = findTopicById(after, id);
      if (topic) {
        cli.success(`+ ${topic.name}  [${id}]`);
        cli.info(`  ${topic.description}`);
      }
    }
  }

  if (removed.length > 0) {
    for (const id of removed) {
      const topic = findTopicById(before, id);
      if (topic) {
        cli.error(`- ${topic.name}  [${id}]`);
      }
    }
  }
}

function findTopicById(
  taxonomy: Taxonomy,
  id: string
): { name: string; description: string } | null {
  for (const topic of taxonomy) {
    if (topic.id === id) return topic;
    for (const sub of topic.subtopics ?? []) {
      if (sub.id === id) return sub;
    }
  }
  return null;
}
