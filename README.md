# XSaved Tagger

CLI tool that semantically tags Twitter/X bookmarks using the Claude API. Reads a collection of ~189 exported bookmarks, sends them to Claude Haiku in batches, and produces enriched metadata: semantic tags, summaries, content classification, and sentiment analysis.

## How it works

```
bookmarks.json → [batch of 15] → Claude Haiku → Zod validation → enriched-bookmarks.json
                                       ↑
                              system prompt (role + JSON schema)
                              + assistant prefill (force raw JSON)
```

1. **Load & strip** — Reads raw bookmarks, drops heavy fields (media blobs, avatar URLs) to minimize token usage
2. **Batch** — Groups bookmarks into batches of 15 per API call (reduces overhead vs one-at-a-time)
3. **Classify** — Claude analyzes each bookmark and returns structured JSON: 2-5 semantic tags, a one-line summary, content type, and sentiment
4. **Validate** — Every response is validated against a Zod schema. Failed batches retry up to 2 times
5. **Track cost** — Token usage and dollar cost are accumulated across all calls (including retries)

## Output schema

```typescript
{
  id: string;
  tags: string[];        // 2-5 lowercase semantic tags
  summary: string;       // max 20 words
  contentType: "opinion" | "advice" | "news" | "humor" | "resource" | "discussion" | "inspiration";
  sentiment: "positive" | "negative" | "neutral" | "mixed";
}
```

## Prompt techniques

- **System/user separation** — System prompt defines Claude's role and output rules; user prompt passes the data
- **Assistant prefill** — Pre-filling the assistant response with `[` forces Claude to continue as a JSON array, preventing markdown wrapping
- **Defensive parsing** — Strips markdown fences as fallback, validates with Zod, retries on schema violations

## Stack

`@anthropic-ai/sdk` · `zod` · `typescript` · `tsx` · `dotenv`

## Usage

```bash
cp .env.example .env  # add your ANTHROPIC_API_KEY
npm install
npm start
```

## Cost

~$0.15 for 189 bookmarks using `claude-haiku-4-5`. Token usage is tracked and printed after each run.
