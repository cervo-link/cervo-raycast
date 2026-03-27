# Cervo: Tauri to Raycast Extension Migration

## Overview

Migrate the Cervo URL manager from a standalone Tauri desktop app to a Raycast extension, adapting features to Raycast-native patterns while preserving core functionality: saving, searching, and managing URLs with clipboard integration.

## Source Project

Cervo Tauri (`/Users/victornogueira/fun/cervo-tauri`) is a keyboard-first floating panel app (Tauri 2 + React 19 + TypeScript) for saving and searching URLs. Features include auto-clipboard detection, SQLite storage, full-text search, delete with confirmation, and configurable settings.

## Architecture

### Commands

| Command | Mode | File | Purpose |
|---|---|---|---|
| `search-url` | `view` | `src/search-url.tsx` | Main List UI -- browse, search, open, copy, delete URLs |
| `save` | `view` | `src/save.tsx` | Form for manually entering a URL to save |
| `quick-save` | `no-view` | `src/quick-save.tsx` | Silently reads clipboard, validates, saves URL, shows HUD |

### Shared Modules

| Module | Purpose |
|---|---|
| `src/lib/db.ts` | SQLite database init and CRUD operations via `executeSQL` from `@raycast/utils` |
| `src/lib/url.ts` | URL validation and normalization |
| `src/lib/time.ts` | Relative time formatter ("2m ago", "3h ago") |
| `src/lib/types.ts` | Shared TypeScript types (`UrlEntry`, etc.) |

### Storage

SQLite database at `environment.supportPath + "/cervo.db"`.

Schema (same as Tauri):

```sql
CREATE TABLE IF NOT EXISTS urls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_urls_created_at ON urls(created_at DESC);
```

Database operations use `executeSQL` from `@raycast/utils` for mutations (INSERT, DELETE, CREATE TABLE) and `useSQL` hook for reactive queries in the List view.

## Command Details

### 1. search-url (Main Command)

Uses `useSQL` hook to reactively query the database. Raycast's built-in `List` filtering is disabled -- instead, `onSearchTextChange` triggers a new SQL query with `LIKE %query%`, matching the Tauri behavior.

**List items show:**
- Title: the URL
- Accessory: relative time ("2m ago", "3h ago") via `relativeTime()` utility

**ActionPanel per item:**
- `Action.OpenInBrowser` -- primary action (Enter)
- `Action.CopyToClipboard` -- Cmd+Shift+C
- Delete action -- Ctrl+X, calls `confirmAlert` with `Destructive` style, then deletes and refreshes the list

**On launch behavior:**
- If "Auto Save Clipboard URL" preference is enabled, reads clipboard via `Clipboard.readText()`, validates, and auto-saves if it's a new valid URL (shows toast on success)

**Empty state:**
- `List.EmptyView` with "No saved URLs yet" message and an action to push to the Save form

### 2. save (Form Command)

Simple `Form` with:
- `Form.TextField` for URL input (placeholder: "https://example.com")
- `Action.SubmitForm` that validates, normalizes, saves to DB, shows success toast
- If "Clear Clipboard After Save" preference is on, clears clipboard after save

### 3. quick-save (No-View Command)

Async function that:
1. Reads clipboard via `Clipboard.readText()`
2. Validates and normalizes the URL
3. Saves to DB via `executeSQL`
4. Shows `showHUD("Saved: example.com")` on success, or `showHUD("No valid URL in clipboard")` on failure
5. If "Clear Clipboard After Save" is on, clears clipboard

Users can bind this to any hotkey in Raycast for one-keystroke saves.

## Preferences

Extension-level preferences defined in `package.json`:

| Name | Type | Title | Default | Description |
|---|---|---|---|---|
| `autoSaveClipboard` | `checkbox` | Auto Save Clipboard URL | `true` | Detect and save URLs from clipboard when opening Search URL |
| `clearClipboardAfterSave` | `checkbox` | Clear Clipboard After Save | `true` | Clear clipboard contents after successfully saving a URL |
| `closeAfterAction` | `checkbox` | Close After Action | `true` | Close Raycast after opening or copying a URL |

## Data Flow

```
quick-save:  Clipboard -> validate -> executeSQL(INSERT) -> showHUD
save:        Form input -> validate -> executeSQL(INSERT) -> Toast
search-url:  useSQL(SELECT) <-> search text changes
             ActionPanel -> open/copy/delete -> executeSQL(DELETE) + revalidate
```

## Shared Library Functions

### lib/db.ts

- `initDatabase()` -- CREATE TABLE IF NOT EXISTS (called before any operation)
- `saveUrl(url: string)` -- normalize, INSERT OR IGNORE, returns `{ saved: boolean, id: number }`
- `searchUrls(query?: string)` -- SELECT with optional LIKE, limit 100, ordered by `created_at DESC`
- `deleteUrl(id: number)` -- DELETE WHERE id = ?

### lib/url.ts

- `normalizeUrl(input: string)` -- trims, auto-prefixes `https://` for bare domains, returns normalized URL or `null`
- `isValidUrl(url: string)` -- checks scheme is http/https, host contains a dot or is localhost

### lib/time.ts

- `relativeTime(isoDate: string)` -- returns "just now", "2m ago", "3h ago", "2d ago", "4mo ago"

### lib/types.ts

```typescript
interface UrlEntry {
  id: number;
  url: string;
  created_at: string;
}
```

## File Structure

```
src/
  search-url.tsx          # Main List command
  save.tsx                # Form command
  quick-save.tsx          # No-view clipboard save command
  lib/
    db.ts                 # SQLite init + CRUD
    url.ts                # Validation + normalization
    time.ts               # relativeTime() formatter
    types.ts              # UrlEntry type
```

## Features NOT Ported (and Why)

| Tauri Feature | Reason for Skipping |
|---|---|
| Global hotkey (Cmd+Option+V) | Raycast handles hotkey assignment natively per command |
| Window management (show/hide/blur) | Raycast manages its own window lifecycle |
| Custom toast WebviewWindow | Raycast has `showToast` and `showHUD` built-in |
| Theme system | Follows Raycast appearance automatically |
| Launch at Login | Raycast itself handles this |
| Vibrancy/transparent window | Raycast's native UI |
| Keyboard navigation (j/k, Ctrl+N/P) | Raycast List has built-in keyboard nav |
| Actions/Settings overlay menus | Replaced by Raycast's native ActionPanel and Preferences |
| Shake animation for invalid URLs | Form validation errors and toast messages instead |
| 2-step delete timer | Replaced by native `confirmAlert` dialog |

## Dependencies

- `@raycast/api` (existing) -- core Raycast components and APIs
- `@raycast/utils` (existing) -- `executeSQL`, `useSQL` for SQLite access

No new dependencies required.
