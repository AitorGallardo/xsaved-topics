import { readFileSync } from "fs";
import { RawBookmark, BookmarkLite } from "./types.js";

const DATA_DIR = new URL(
  "../../../xsaved-landing-page/public/demo/main-demo/data/",
  import.meta.url
);

function readJSON<T>(filename: string): T {
  return JSON.parse(readFileSync(new URL(filename, DATA_DIR), "utf-8"));
}

function extractMediaTypes(media: unknown[]): string[] | undefined {
  if (!media || media.length === 0) return undefined;
  const types = media
    .filter((m): m is { type: string } => typeof m === "object" && m !== null && "type" in m)
    .map((m) => m.type);
  return types.length > 0 ? types : undefined;
}

/**
 * Filter out test/garbage topic names (user's test data from development).
 * Real topic names are at least 3 chars and don't look like test strings.
 */
function isRealTopicName(name: string): boolean {
  if (name.length < 3) return false;
  const noise = /^(topic\d|new_topic|asfasdf|aaaffffff|looola|ueyyeye|keep.adding|more.*more|never.*end|_more)/i;
  return !noise.test(name);
}

/**
 * Load bookmarks with enriched context from folders and topics.
 *
 * Resolves folderId → folder name and filters out test topic noise.
 * This context helps Phase 1 produce a taxonomy that aligns with
 * how the user already organizes their bookmarks.
 */
export function loadBookmarks(): BookmarkLite[] {
  const raw: RawBookmark[] = readJSON("bookmarks.json");
  const folders: Record<string, string> = readJSON("folders.json");
  const topicsMap: Record<string, string> = readJSON("topics.json");

  return raw.map((b) => {
    const lite: BookmarkLite = {
      id: b.id,
      text: b.text,
      author: b.author,
      created_at: b.created_at,
      bookmarked_at: b.bookmarked_at,
      tags: b.tags,
    };

    if (b.notes) lite.notes = b.notes;

    // Resolve folder name from ID
    if (b.folderId && folders[b.folderId]) {
      lite.folder = folders[b.folderId];
    }

    const mediaTypes = extractMediaTypes(b.media);
    if (mediaTypes) lite.mediaTypes = mediaTypes;

    return lite;
  });
}

/**
 * Load the user's existing manual topic names (filtered for noise).
 * These are passed to Phase 1 as seed context.
 */
export function loadExistingTopicNames(): string[] {
  const topicsMap: Record<string, string> = readJSON("topics.json");
  return Object.values(topicsMap).filter(isRealTopicName);
}
