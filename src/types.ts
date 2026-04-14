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
  aiTopics?: string[];
  folderId?: string;
  media: unknown[];
}

/**
 * The lightweight version we'll send to Claude.
 *
 * We strip `avatar_url` and `media` because:
 * - They contain file paths / nested objects that are meaningless to Claude
 * - Every token we send costs money — these fields add bulk with zero value
 * - We keep `mediaTypes` as a simple string[] so Claude knows if the tweet
 *   had images/video, without the full blob
 */
export interface BookmarkLite {
  id: string;
  text: string;
  author: string;
  created_at: string;
  bookmarked_at: string;
  tags: string[];
  notes?: string;
  aiTopics?: string[];
  mediaTypes?: string[];
}

/**
 * What Claude returns after analyzing a bookmark.
 * This mirrors the Zod schema in validate.ts — keep them in sync.
 */
export interface TagResult {
  id: string;
  tags: string[];
  summary: string;
  contentType: string;
  sentiment: string;
}

/**
 * A bookmark enriched with Claude's analysis.
 */
export interface EnrichedBookmark extends BookmarkLite {
  aiTags: string[];
  aiSummary: string;
  aiContentType: string;
  aiSentiment: string;
}
