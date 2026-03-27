# Workspace Selection Design

## Overview

Add dynamic workspace selection to the Cervo Raycast extension via a `List.Dropdown` in the search bar. Workspaces and member ID are fetched from the API on load, replacing the static `workspaceId` and `memberId` preferences.

## Changes

### Preferences

**Remove:** `workspaceId`, `memberId` -- now fetched dynamically from the API.

**Keep:** `apiUrl`, `apiKey`, `autoSaveClipboard`, `clearClipboardAfterSave`, `closeAfterAction`.

### New API Calls

- `GET /members/me` -- fetch authenticated member's ID. Called once on load when API is configured.
- `GET /workspaces/me` -- fetch list of workspaces the member belongs to. Called once on load.

### UI

A `List.Dropdown` appears as a `searchBarAccessory` on the List component.

**When API is configured:**
- Dropdown is populated with workspace names from `GET /workspaces/me`
- Default selection is the last used workspace (persisted via `storeValue` prop)
- Changing the workspace re-fetches bookmarks for that workspace

**When API is not configured:**
- Dropdown shows a single disabled item: "Configure API to use workspaces"
- Extension works in local-only mode with no workspace filtering

### Data Flow

```
On load:
  API configured?
    yes → GET /members/me → store memberId in state
        → GET /workspaces/me → populate dropdown
        → Selected workspace → filter bookmarks (local SQL + API search)
    no  → Dropdown shows "Configure API to use workspaces" (disabled)
        → Local-only mode, no workspace filtering
```

### Impact on Existing Features

All existing features work the same, but use dynamically fetched `memberId` and the selected `workspaceId` instead of static preferences:

- **Save (paste in search bar):** uses selected workspace + fetched memberId
- **Auto-clipboard save on launch:** uses selected workspace + fetched memberId
- **API search:** scoped to selected workspace
- **Enrichment polling:** scoped to selected workspace
- **Delete sync:** unchanged (searches by URL)
- **Retry:** uses selected workspace + fetched memberId

### API Client Changes

`src/lib/api.ts` currently reads `workspaceId` and `memberId` from preferences via `getApiConfig()`. This needs to change:

- `getApiConfig()` returns only `apiUrl` and `apiKey` (auth config)
- All API functions that need `workspaceId`/`memberId` receive them as parameters
- New functions: `apiFetchMember()` and `apiFetchWorkspaces()`

### Types Changes

`src/lib/types.ts`:
- Remove `workspaceId` and `memberId` from `Preferences` interface
- Add `Workspace` interface: `{ id: string; name: string }`
- Add `Member` interface: `{ id: string; name: string }`

### State Management

In `search-url.tsx`, new state:
- `memberId: string | null` -- fetched from `GET /members/me`
- `selectedWorkspaceId: string` -- from dropdown selection
- `workspaces: Workspace[]` -- fetched from `GET /workspaces/me`

The `memberId` and `selectedWorkspaceId` are passed down to all API calls instead of being read from preferences.
