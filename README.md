# Cervo

Save and search URLs with AI-powered summaries. A Raycast extension that bookmarks URLs locally and optionally syncs with the [Cervo API](https://github.com/cervo-link/cervo-api) for semantic search, auto-summarization, and tagging.

## Features

- **Paste to save** -- Paste a URL in the search bar and press Enter to save it
- **Auto-save from clipboard** -- Automatically detects and saves URLs from your clipboard on launch
- **Local-first** -- URLs are stored in a local SQLite database for instant access
- **API sync** -- Optionally syncs with Cervo API for web scraping, AI summarization, and semantic search
- **Detail panel** -- Browse items to see AI-generated titles, descriptions, tags, and processing status
- **Semantic search** -- When connected to the API, search by meaning, not just keywords

## Actions

| Shortcut | Action |
|---|---|
| **Enter** | Open URL in default browser |
| **Cmd+Shift+C** | Copy URL to clipboard |
| **Cmd+R** | Reprocess failed/processing URL |
| **Cmd+Backspace** | Delete URL (with confirmation) |

## Preferences

| Setting | Default | Description |
|---|---|---|
| Auto Save Clipboard URL | On | Auto-detect and save URLs from clipboard on launch |
| Clear Clipboard After Save | On | Clear clipboard after saving a URL |
| Close After Action | On | Close Raycast after opening or copying a URL |

### API Integration (optional)

To enable AI-powered summaries and semantic search, configure these in Raycast Settings > Extensions > Cervo:

| Setting | Description |
|---|---|
| Cervo API URL | Base URL (e.g., `http://localhost:8090`) |
| API Key | Your Cervo API key |
| Workspace ID | UUID of the workspace |
| Member ID | Your member UUID |

## Status Indicators

Each saved URL shows a colored status dot:

- **Green** -- Ready: AI title, description, and tags available
- **Yellow** -- Processing: API is scraping and summarizing the page
- **Red** -- Failed: processing timed out or the URL is unreachable (retry with Cmd+R)
- **Grey** -- Local only: no API configured

## Development

### Prerequisites

- [Raycast](https://raycast.com/) installed
- [Node.js](https://nodejs.org/) 18+
- npm

### Setup

```bash
git clone https://github.com/cervo-link/cervo-raycast.git
cd cervo-raycast
npm install
```

### Run in Development

```bash
npm run dev
```

Open Raycast and search for "Cervo" to test.

### Build & Lint

```bash
npm run build
npm run lint
npm run fix-lint  # auto-fix issues
```

## Architecture

- **Storage**: Local SQLite via `sqlite3` CLI (writes) + `useSQL` hook from `@raycast/utils` (reads)
- **API client**: `src/lib/api.ts` -- fire-and-forget saves, background enrichment polling, semantic search
- **URL validation**: `src/lib/url.ts` -- same normalization rules as the [Cervo Tauri app](https://github.com/cervo-link/cervo-tauri)
- **Hybrid sync**: saves locally first (instant), syncs to API in background, caches enriched data back to SQLite

## License

MIT
