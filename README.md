# Cervo

Save and search URLs from your clipboard with one keystroke. A Raycast extension for fast URL bookmarking.

## Commands

### Quick Save

Reads your clipboard, validates the URL, and saves it to your local database instantly. Assign a hotkey in Raycast for one-keystroke saves.

### Search URLs

Browse, search, open, copy, and delete your saved URLs. Supports full-text search with `LIKE` matching.

**Actions:**
- **Enter** -- Open URL in default browser
- **Cmd+Shift+C** -- Copy URL to clipboard
- **Ctrl+X** -- Delete URL (with confirmation)

## Preferences

| Setting | Default | Description |
|---|---|---|
| Auto Save Clipboard URL | On | Auto-detect and save URLs from clipboard when opening Search URLs |
| Clear Clipboard After Save | On | Clear clipboard after saving a URL |
| Close After Action | On | Close Raycast after opening or copying a URL |

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

This starts the extension in development mode. Open Raycast and search for "Quick Save" or "Search URLs" to test.

### Build

```bash
npm run build
```

### Lint

```bash
npm run lint
npm run fix-lint  # auto-fix issues
```

## How It Works

- URLs are stored in a local SQLite database at Raycast's extension support path
- URL validation and normalization follows the same rules as the [Cervo Tauri app](https://github.com/cervo-link/cervo-tauri): auto-prefixes `https://`, validates scheme/host, rejects invalid URLs
- Duplicate URLs are silently ignored
- Search uses SQL `LIKE %query%` matching, returning up to 100 results sorted by most recent

## License

MIT
