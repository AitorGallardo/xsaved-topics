# XSaved Topics

CLI tool that generates a **personalized topic taxonomy** for a user's Twitter/X bookmark collection and labels each bookmark against it. Built on the Claude API.

Instead of applying a fixed, generic set of categories, it analyzes the user's actual corpus and proposes a small taxonomy of topics that reflects what that user actually reads — then assigns each bookmark to the best-fitting topics.

## Architecture

Two-phase pipeline:

```
┌──────────────────────────────────────────────────────────────┐
│ Phase 1: Taxonomy Generation                                 │
│   Input:  full corpus (bookmarks + manual tags + folders)    │
│   Output: taxonomy.json                                      │
│           5-8 top-level topics, 0-3 subtopics each           │
│           each with { id, name, description }                │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ Phase 2: Labeling                                            │
│   Input:  taxonomy + batch of bookmarks                      │
│   Output: enriched-bookmarks.json                            │
│           each bookmark → up to 5 topic ids from taxonomy    │
└──────────────────────────────────────────────────────────────┘
```

Phase 1 is an expensive corpus-level call that runs once per regeneration. Phase 2 is cheap batched work that runs every time new bookmarks are added.

## Incremental regeneration

When new bookmarks arrive, the tool loads the existing taxonomy and asks Claude: *do these new bookmarks fit existing topics, or do they reveal a new topic we should add?* This keeps topic ids stable across runs — no silent renaming that would break downstream references.

## Engineering patterns

- **Corpus-aware prompting** — Phase 1 sees the whole collection, enabling real personalization
- **Stable ids with human-readable names + descriptions** — Phase 2 has a precise anchor for consistent labeling
- **Two-layer validation** — Zod schema for shape + custom check that every assigned topic id actually exists in the taxonomy
- **Batched Phase 2 with retry** — 15 bookmarks per API call, 2 retries on validation failure
- **Per-model cost tracking** — token usage and dollar cost tracked across all calls including retries

## Stack

`@anthropic-ai/sdk` · `zod` · `typescript` · `tsx` · `dotenv`

## Usage

```bash
cp .env.example .env  # add your ANTHROPIC_API_KEY
npm install
npm start
```

On first run, generates `output/taxonomy.json` then labels all bookmarks. On subsequent runs, extends the existing taxonomy with any new topics needed and re-labels.
