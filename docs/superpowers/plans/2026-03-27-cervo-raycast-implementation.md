# Cervo Raycast Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Cervo URL manager as a Raycast extension with three commands (search, save, quick-save), SQLite storage, and clipboard integration.

**Architecture:** Three Raycast commands share a common library layer (`src/lib/`) for database operations (SQLite via `executeSQL`/`useSQL` from `@raycast/utils`), URL validation/normalization (Node.js `URL` constructor), and time formatting. Extension-level preferences control clipboard behavior.

**Tech Stack:** TypeScript, React, `@raycast/api`, `@raycast/utils` (executeSQL/useSQL), SQLite

**Spec:** `docs/superpowers/specs/2026-03-27-cervo-tauri-to-raycast-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `package.json` | Modify | Add `quick-save` command, add 3 extension preferences |
| `src/lib/types.ts` | Create | `UrlEntry` interface and `SaveResult` type |
| `src/lib/url.ts` | Create | `normalizeUrl()` and `looksLikeUrl()` functions |
| `src/lib/time.ts` | Create | `relativeTime()` formatter (port from Tauri) |
| `src/lib/db.ts` | Create | `initDatabase()`, `saveUrl()`, `searchUrls()`, `deleteUrl()` |
| `src/quick-save.tsx` | Create | No-view command: clipboard read, validate, save, HUD |
| `src/save.tsx` | Modify (rewrite) | Form command: URL text field, validate, save, toast |
| `src/search-url.tsx` | Modify (rewrite) | List command: useSQL search, ActionPanel, clipboard auto-save |

---

### Task 1: Update package.json manifest

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add quick-save command and preferences to package.json**

Open `package.json` and make these changes:

1. Add the `quick-save` command to the `commands` array:

```json
{
  "name": "quick-save",
  "title": "Quick Save",
  "subtitle": "Save URL from Clipboard",
  "description": "Reads clipboard, validates URL, and saves it instantly",
  "mode": "no-view"
}
```

2. Update the existing `save` command description:

```json
{
  "name": "save",
  "title": "Save URL",
  "subtitle": "Add new URL",
  "description": "Manually save a URL to your collection",
  "mode": "view"
}
```

3. Update the existing `search-url` command description:

```json
{
  "name": "search-url",
  "title": "Search URLs",
  "subtitle": "Browse & search saved URLs",
  "description": "Search, open, copy, and manage your saved URLs",
  "mode": "view"
}
```

4. Add extension-level `preferences` array after `commands`:

```json
"preferences": [
  {
    "name": "autoSaveClipboard",
    "title": "Auto Save Clipboard URL",
    "description": "Detect and save URLs from clipboard when opening Search URLs",
    "type": "checkbox",
    "default": true,
    "required": false,
    "label": "Auto Save Clipboard URL"
  },
  {
    "name": "clearClipboardAfterSave",
    "title": "Clear Clipboard After Save",
    "description": "Clear clipboard contents after successfully saving a URL",
    "type": "checkbox",
    "default": true,
    "required": false,
    "label": "Clear Clipboard After Save"
  },
  {
    "name": "closeAfterAction",
    "title": "Close After Action",
    "description": "Close Raycast after opening or copying a URL",
    "type": "checkbox",
    "default": true,
    "required": false,
    "label": "Close After Action"
  }
]
```

- [ ] **Step 2: Verify manifest is valid**

Run: `cd /Users/victornogueira/raycast-extensions/cervo-raycast/cervo && npm run build`

Expected: Build succeeds (may warn about missing `quick-save.tsx` -- that's fine for now, we'll create it in Task 6).

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat: update manifest with quick-save command and preferences"
```

---

### Task 2: Create types module

**Files:**
- Create: `src/lib/types.ts`

- [ ] **Step 1: Create the types file**

Create `src/lib/types.ts`:

```typescript
export interface UrlEntry {
  id: number;
  url: string;
  created_at: string;
}

export type SaveResult =
  | { type: "saved"; id: number; url: string }
  | { type: "duplicate"; id: number; url: string }
  | { type: "invalid" };

export interface Preferences {
  autoSaveClipboard: boolean;
  clearClipboardAfterSave: boolean;
  closeAfterAction: boolean;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add shared types for UrlEntry, SaveResult, Preferences"
```

---

### Task 3: Create URL validation and normalization module

**Files:**
- Create: `src/lib/url.ts`

This ports the Rust `normalize_url` logic from the Tauri app to TypeScript using Node's built-in `URL` constructor.

- [ ] **Step 1: Create the url module**

Create `src/lib/url.ts`:

```typescript
/**
 * Normalizes a raw URL string:
 * - Trims whitespace
 * - Auto-prefixes https:// for bare domains
 * - Validates scheme (http/https only)
 * - Validates host (must contain a dot or be "localhost")
 * - Validates host parts (non-empty, alphanumeric + hyphens)
 *
 * Returns the normalized URL string, or null if invalid.
 */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const withScheme =
    trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? trimmed
      : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  const host = parsed.hostname;
  if (!host) return null;

  if (host !== "localhost" && !host.includes(".")) {
    return null;
  }

  if (host !== "localhost") {
    const parts = host.split(".");
    const valid = parts.every(
      (part) => part.length > 0 && /^[a-zA-Z0-9-]+$/.test(part)
    );
    if (!valid) return null;
  }

  return parsed.toString();
}

/**
 * Quick check if a string looks like a URL worth auto-saving from clipboard.
 * Checks for http://, https://, or domain-like patterns (contains a dot).
 */
export function looksLikeUrl(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    /^[a-zA-Z0-9-]+\.[a-zA-Z]/.test(trimmed)
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/url.ts
git commit -m "feat: add URL validation and normalization module"
```

---

### Task 4: Create time formatting module

**Files:**
- Create: `src/lib/time.ts`

Direct port from the Tauri app's `src/lib/time.ts`.

- [ ] **Step 1: Create the time module**

Create `src/lib/time.ts`:

```typescript
export function relativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(`${isoDate}Z`).getTime();
  const diffSeconds = Math.floor((now - then) / 1000);

  if (diffSeconds < 60) {
    return "just now";
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return `${diffDays}d ago`;
  }

  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/time.ts
git commit -m "feat: add relative time formatter"
```

---

### Task 5: Create database module

**Files:**
- Create: `src/lib/db.ts`

Uses `executeSQL` from `@raycast/utils` for all database operations. The database file lives at `environment.supportPath + "/cervo.db"`.

- [ ] **Step 1: Create the database module**

Create `src/lib/db.ts`:

```typescript
import { environment } from "@raycast/api";
import { executeSQL } from "@raycast/utils";
import path from "path";
import { normalizeUrl } from "./url";
import { UrlEntry, SaveResult } from "./types";

const DB_PATH = path.join(environment.supportPath, "cervo.db");

export function getDbPath(): string {
  return DB_PATH;
}

export async function initDatabase(): Promise<void> {
  await executeSQL(DB_PATH, `
    CREATE TABLE IF NOT EXISTS urls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await executeSQL(DB_PATH, `
    CREATE INDEX IF NOT EXISTS idx_urls_created_at ON urls(created_at DESC)
  `);
}

export async function saveUrl(raw: string): Promise<SaveResult> {
  const normalized = normalizeUrl(raw);
  if (!normalized) {
    return { type: "invalid" };
  }

  await initDatabase();

  // Try to insert; INSERT OR IGNORE silently skips duplicates
  await executeSQL(DB_PATH, `INSERT OR IGNORE INTO urls (url) VALUES ('${normalized.replace(/'/g, "''")}')`);

  // Check if this URL exists (either just inserted or already existed)
  const rows = await executeSQL<{ id: number; url: string }>(
    DB_PATH,
    `SELECT id, url FROM urls WHERE url = '${normalized.replace(/'/g, "''")}'`
  );

  if (rows.length === 0) {
    return { type: "invalid" };
  }

  // Determine if it was a new insert by checking if created_at is very recent (within last 2 seconds)
  const check = await executeSQL<{ is_new: number }>(
    DB_PATH,
    `SELECT (julianday('now') - julianday(created_at)) * 86400 < 2 AS is_new FROM urls WHERE id = ${rows[0].id}`
  );

  const isNew = check.length > 0 && check[0].is_new === 1;

  return isNew
    ? { type: "saved", id: rows[0].id, url: rows[0].url }
    : { type: "duplicate", id: rows[0].id, url: rows[0].url };
}

export async function deleteUrl(id: number): Promise<void> {
  await initDatabase();
  await executeSQL(DB_PATH, `DELETE FROM urls WHERE id = ${id}`);
}

/**
 * Builds the SQL query string for useSQL hook.
 * useSQL needs the raw query; it handles execution internally.
 */
export function buildSearchQuery(query?: string): string {
  if (!query || query.trim() === "") {
    return "SELECT id, url, created_at FROM urls ORDER BY created_at DESC LIMIT 100";
  }
  const escaped = query.replace(/'/g, "''");
  return `SELECT id, url, created_at FROM urls WHERE url LIKE '%${escaped}%' ORDER BY created_at DESC LIMIT 100`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat: add SQLite database module with CRUD operations"
```

---

### Task 6: Implement quick-save command

**Files:**
- Create: `src/quick-save.tsx`

No-view command that reads clipboard, validates, saves, and shows HUD.

- [ ] **Step 1: Create the quick-save command**

Create `src/quick-save.tsx`:

```typescript
import { Clipboard, showHUD, getPreferenceValues } from "@raycast/api";
import { saveUrl } from "./lib/db";
import { looksLikeUrl } from "./lib/url";
import { Preferences } from "./lib/types";

export default async function Command() {
  const prefs = getPreferenceValues<Preferences>();

  const clipboardText = await Clipboard.readText();
  if (!clipboardText || !looksLikeUrl(clipboardText)) {
    await showHUD("No valid URL in clipboard");
    return;
  }

  const result = await saveUrl(clipboardText);

  switch (result.type) {
    case "saved": {
      const host = new URL(result.url).hostname;
      await showHUD(`Saved: ${host}`);
      if (prefs.clearClipboardAfterSave) {
        await Clipboard.clear();
      }
      break;
    }
    case "duplicate": {
      const host = new URL(result.url).hostname;
      await showHUD(`Already saved: ${host}`);
      break;
    }
    case "invalid":
      await showHUD("Invalid URL in clipboard");
      break;
  }
}
```

- [ ] **Step 2: Build and verify**

Run: `cd /Users/victornogueira/raycast-extensions/cervo-raycast/cervo && npm run build`

Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/quick-save.tsx
git commit -m "feat: add quick-save no-view command for clipboard URL saving"
```

---

### Task 7: Implement save command

**Files:**
- Modify (rewrite): `src/save.tsx`

Form command with a single URL text field that validates, normalizes, and saves.

- [ ] **Step 1: Rewrite the save command**

Replace the contents of `src/save.tsx` with:

```typescript
import {
  Form,
  ActionPanel,
  Action,
  showToast,
  Toast,
  Clipboard,
  popToRoot,
  getPreferenceValues,
} from "@raycast/api";
import { useState } from "react";
import { saveUrl } from "./lib/db";
import { normalizeUrl } from "./lib/url";
import { Preferences } from "./lib/types";

export default function Command() {
  const prefs = getPreferenceValues<Preferences>();
  const [urlError, setUrlError] = useState<string | undefined>();

  async function handleSubmit(values: { url: string }) {
    const raw = values.url.trim();
    if (!raw) {
      setUrlError("URL is required");
      return;
    }

    const normalized = normalizeUrl(raw);
    if (!normalized) {
      setUrlError("Invalid URL");
      return;
    }

    const result = await saveUrl(raw);

    switch (result.type) {
      case "saved":
        await showToast({ style: Toast.Style.Success, title: "URL Saved", message: result.url });
        if (prefs.clearClipboardAfterSave) {
          await Clipboard.clear();
        }
        await popToRoot();
        break;
      case "duplicate":
        await showToast({ style: Toast.Style.Success, title: "Already Saved", message: result.url });
        await popToRoot();
        break;
      case "invalid":
        setUrlError("Invalid URL");
        break;
    }
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save URL" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="url"
        title="URL"
        placeholder="https://example.com"
        error={urlError}
        onChange={() => setUrlError(undefined)}
        onBlur={(event) => {
          const value = event.target.value;
          if (value && !normalizeUrl(value)) {
            setUrlError("Invalid URL");
          }
        }}
      />
    </Form>
  );
}
```

- [ ] **Step 2: Build and verify**

Run: `cd /Users/victornogueira/raycast-extensions/cervo-raycast/cervo && npm run build`

Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/save.tsx
git commit -m "feat: implement save command with URL form and validation"
```

---

### Task 8: Implement search-url command

**Files:**
- Modify (rewrite): `src/search-url.tsx`

The main command: List view with SQL-driven search, ActionPanel with open/copy/delete, and auto-clipboard-save on launch.

- [ ] **Step 1: Rewrite the search-url command**

Replace the contents of `src/search-url.tsx` with:

```typescript
import {
  List,
  ActionPanel,
  Action,
  Icon,
  confirmAlert,
  Alert,
  showToast,
  Toast,
  Clipboard,
  getPreferenceValues,
  popToRoot,
  Keyboard,
} from "@raycast/api";
import { useSQL } from "@raycast/utils";
import { useState, useEffect, useRef } from "react";
import { getDbPath, initDatabase, deleteUrl, saveUrl, buildSearchQuery } from "./lib/db";
import { looksLikeUrl } from "./lib/url";
import { relativeTime } from "./lib/time";
import { UrlEntry, Preferences } from "./lib/types";

export default function Command() {
  const prefs = getPreferenceValues<Preferences>();
  const [searchText, setSearchText] = useState("");
  const clipboardChecked = useRef(false);

  // Ensure database exists before querying
  const [dbReady, setDbReady] = useState(false);
  useEffect(() => {
    initDatabase().then(() => setDbReady(true));
  }, []);

  // Auto-save clipboard URL on launch
  useEffect(() => {
    if (!dbReady || clipboardChecked.current || !prefs.autoSaveClipboard) return;
    clipboardChecked.current = true;

    (async () => {
      const text = await Clipboard.readText();
      if (!text || !looksLikeUrl(text)) return;

      const result = await saveUrl(text);
      if (result.type === "saved") {
        const host = new URL(result.url).hostname;
        await showToast({ style: Toast.Style.Success, title: "Saved from clipboard", message: host });
        if (prefs.clearClipboardAfterSave) {
          await Clipboard.clear();
        }
      }
    })();
  }, [dbReady]);

  const query = buildSearchQuery(searchText);
  const { data, isLoading, revalidate } = useSQL<UrlEntry>(getDbPath(), query);

  async function handleDelete(entry: UrlEntry) {
    const confirmed = await confirmAlert({
      title: "Delete URL",
      message: `Are you sure you want to delete ${entry.url}?`,
      primaryAction: {
        title: "Delete",
        style: Alert.ActionStyle.Destructive,
      },
    });

    if (confirmed) {
      await deleteUrl(entry.id);
      await showToast({ style: Toast.Style.Success, title: "Deleted", message: entry.url });
      revalidate();
    }
  }

  const urls = data || [];

  return (
    <List
      isLoading={isLoading || !dbReady}
      searchBarPlaceholder="Search saved URLs..."
      onSearchTextChange={setSearchText}
      filtering={false}
      throttle
    >
      {urls.length === 0 && !isLoading ? (
        <List.EmptyView
          title="No saved URLs yet"
          description="Use Save URL or Quick Save to add URLs"
          icon={Icon.Globe}
        />
      ) : (
        urls.map((entry) => (
          <List.Item
            key={entry.id}
            title={entry.url}
            accessories={[{ text: relativeTime(entry.created_at) }]}
            actions={
              <ActionPanel>
                <Action.OpenInBrowser
                  url={entry.url}
                  onOpen={prefs.closeAfterAction ? () => popToRoot() : undefined}
                />
                <Action.CopyToClipboard
                  content={entry.url}
                  shortcut={Keyboard.Shortcut.Common.Copy}
                  onCopy={prefs.closeAfterAction ? () => popToRoot() : undefined}
                />
                <Action
                  title="Delete URL"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={Keyboard.Shortcut.Common.Remove}
                  onAction={() => handleDelete(entry)}
                />
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}
```

- [ ] **Step 2: Build and verify**

Run: `cd /Users/victornogueira/raycast-extensions/cervo-raycast/cervo && npm run build`

Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/search-url.tsx
git commit -m "feat: implement search-url command with SQL search, actions, and clipboard auto-save"
```

---

### Task 9: Lint and final verification

**Files:**
- All files

- [ ] **Step 1: Run linter**

Run: `cd /Users/victornogueira/raycast-extensions/cervo-raycast/cervo && npm run lint`

Expected: No errors (warnings are acceptable).

If there are lint errors, fix them.

- [ ] **Step 2: Run build**

Run: `cd /Users/victornogueira/raycast-extensions/cervo-raycast/cervo && npm run build`

Expected: Build succeeds with no errors.

- [ ] **Step 3: Fix any issues and commit**

If fixes were needed:
```bash
git add -A
git commit -m "fix: resolve lint and build issues"
```

---

### Task 10: Manual smoke test in Raycast

**Files:** None (testing only)

- [ ] **Step 1: Start dev mode**

Run: `cd /Users/victornogueira/raycast-extensions/cervo-raycast/cervo && npm run dev`

- [ ] **Step 2: Test Quick Save command**

1. Copy a URL to clipboard (e.g. `https://github.com`)
2. Open Raycast, type "Quick Save", run the command
3. Expected: HUD shows "Saved: github.com"
4. Copy a non-URL to clipboard (e.g. "hello world")
5. Run Quick Save again
6. Expected: HUD shows "No valid URL in clipboard"

- [ ] **Step 3: Test Save URL command**

1. Open Raycast, type "Save URL"
2. Enter `example.com` in the URL field, press Enter
3. Expected: Toast shows "URL Saved" with `https://example.com/`
4. Enter `not a url !!!` in the URL field, tab away to trigger blur
5. Expected: Error text "Invalid URL" appears under the field

- [ ] **Step 4: Test Search URLs command**

1. Open Raycast, type "Search URLs"
2. Expected: List shows previously saved URLs with relative times
3. Type "github" in search bar
4. Expected: List filters to show only URLs containing "github"
5. Select a URL, press Enter
6. Expected: Opens in default browser
7. Select a URL, press Cmd+Shift+C
8. Expected: URL copied to clipboard
9. Select a URL, press Ctrl+X
10. Expected: Confirmation dialog appears; confirm to delete

- [ ] **Step 5: Test clipboard auto-save**

1. Copy a new URL to clipboard (e.g. `https://raycast.com`)
2. Open "Search URLs" command
3. Expected: Toast shows "Saved from clipboard" with the hostname
4. The URL appears in the list
