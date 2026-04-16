import { readFileSync } from "fs";
import { RawBookmark, BookmarkLite } from "./types.js";

const BOOKMARKS_PATH = new URL(
  "../../../xsaved-landing-page/public/demo/main-demo/data/bookmarks.json",
  import.meta.url
);

/**
 * Extract just the media types (e.g. ["image", "video"]) from the raw media array.
 * This gives Claude useful context without the heavy nested objects.
 */
function extractMediaTypes(media: unknown[]): string[] | undefined {
  if (!media || media.length === 0) return undefined;

  const types = media
    .filter((m): m is { type: string } => typeof m === "object" && m !== null && "type" in m)
    .map((m) => m.type);

  return types.length > 0 ? types : undefined;
}

/**
 * Load bookmarks from JSON and strip heavy fields.
 * Returns lightweight BookmarkLite[] ready for Claude.
 */
export function loadBookmarks(): BookmarkLite[] {
  const raw: RawBookmark[] = JSON.parse(readFileSync(BOOKMARKS_PATH, "utf-8"));

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

    const mediaTypes = extractMediaTypes(b.media);
    if (mediaTypes) lite.mediaTypes = mediaTypes;

    return lite;
  });
}
