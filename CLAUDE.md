# CLAUDE.md

## Project Overview

Cervo Raycast is a Raycast extension for saving and searching URLs with optional AI-powered enrichment via the Cervo API.

## Tech Stack

- TypeScript, React
- `@raycast/api` and `@raycast/utils`
- SQLite for local storage (writes via `/usr/bin/sqlite3` CLI, reads via `useSQL` hook)
- Cervo API for optional sync, semantic search, and AI enrichment

## Key Architecture Decisions

- **`executeSQL` from `@raycast/utils` is read-only** -- all write operations (INSERT, DELETE, UPDATE, CREATE TABLE) must use `execFileSync("/usr/bin/sqlite3", ...)` directly
- **Hybrid local + API**: saves locally first for instant feedback, syncs to API in background, caches enriched data back to SQLite
- **Single command**: everything (save, search, browse) happens in one `search-url.tsx` List view
- **Polling for status**: items in processing state are polled every 5s; items older than 3 minutes with no API result are marked as failed client-side
- **API is optional**: all features work locally if API preferences are not configured

## File Structure

```
src/
  search-url.tsx    # Single command: list view with save/search/browse
  lib/
    api.ts          # Cervo API client (save, search, enrich, delete, retry)
    db.ts           # SQLite CRUD (initDatabase, saveUrl, enrichUrl, deleteUrl, buildSearchQuery)
    url.ts          # URL validation and normalization
    time.ts         # Relative time formatter
    types.ts        # Shared TypeScript types
```

## Commands

```bash
npm run dev       # Start development mode
npm run build     # Build for distribution
npm run lint      # Check linting
npm run fix-lint  # Auto-fix lint issues
```

## Important Patterns

- `enrichUrl()` caches API data (title, description, tags, status, bookmark ID) back to local SQLite
- `buildSearchQuery()` returns raw SQL strings consumed by the `useSQL` hook
- `looksLikeUrl()` is used for clipboard detection and search bar URL detection
- `normalizeUrl()` handles validation: auto-prefixes https://, validates scheme/host, rejects invalid URLs
- Status resolution: `api_status` field in SQLite, with 3-minute timeout fallback to "failed"

## Gotchas

- SQLite `ALTER TABLE ADD COLUMN` is wrapped in try/catch for migration (column may already exist)
- `relativeTime()` handles both SQLite dates (no timezone) and API dates (with Z suffix)
- Raycast `List.Item` icon/accessory sizes are not configurable
- Raycast `List` search bar has no submit event -- URL saving is done via a special "Save" list item that appears when the search text looks like a URL
