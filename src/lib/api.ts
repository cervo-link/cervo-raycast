import { getPreferenceValues } from "@raycast/api";
import { Preferences, ApiBookmark } from "./types";

function getApiConfig(): { apiUrl: string; apiKey: string; workspaceId: string; memberId: string } | null {
  const prefs = getPreferenceValues<Preferences>();
  if (!prefs.apiUrl || !prefs.apiKey || !prefs.workspaceId || !prefs.memberId) {
    return null;
  }
  return {
    apiUrl: prefs.apiUrl.replace(/\/$/, ""),
    apiKey: prefs.apiKey,
    workspaceId: prefs.workspaceId,
    memberId: prefs.memberId,
  };
}

/**
 * Save a bookmark to the Cervo API.
 * Returns true if synced successfully, false otherwise.
 * Local save is always the source of truth.
 */
export async function apiSaveBookmark(url: string): Promise<boolean> {
  const config = getApiConfig();
  if (!config) return false;

  try {
    const response = await fetch(`${config.apiUrl}/bookmarks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": config.apiKey,
      },
      body: JSON.stringify({
        workspaceId: config.workspaceId,
        memberId: config.memberId,
        url,
        source: "raycast",
      }),
    });
    return response.ok || response.status === 201;
  } catch {
    return false;
  }
}

/**
 * Search bookmarks via the Cervo API (semantic vector search).
 * Returns empty array on failure.
 */
export async function apiSearchBookmarks(text: string, limit = 10): Promise<ApiBookmark[]> {
  const config = getApiConfig();
  if (!config) return [];

  try {
    const params = new URLSearchParams({
      workspaceId: config.workspaceId,
      memberId: config.memberId,
      text,
      limit: String(limit),
    });

    const response = await fetch(`${config.apiUrl}/bookmarks?${params}`, {
      headers: {
        "X-API-Key": config.apiKey,
      },
    });

    if (!response.ok) return [];
    return (await response.json()) as ApiBookmark[];
  } catch {
    return [];
  }
}

/**
 * Fetch enriched data for a list of URLs by searching the API for each URL.
 * Used to backfill local items that don't have titles yet.
 * Returns all bookmarks found.
 */
export async function apiFetchEnrichedData(urls: string[]): Promise<ApiBookmark[]> {
  const config = getApiConfig();
  if (!config || urls.length === 0) return [];

  const results: ApiBookmark[] = [];
  const seen = new Set<string>();

  for (const url of urls) {
    try {
      const params = new URLSearchParams({
        workspaceId: config.workspaceId,
        memberId: config.memberId,
        text: url,
        limit: "5",
      });

      const response = await fetch(`${config.apiUrl}/bookmarks?${params}`, {
        headers: { "X-API-Key": config.apiKey },
      });

      if (response.ok) {
        const bookmarks = (await response.json()) as ApiBookmark[];
        for (const b of bookmarks) {
          if (!seen.has(b.id)) {
            seen.add(b.id);
            results.push(b);
          }
        }
      }
    } catch {
      // continue with next URL
    }
  }

  return results;
}

/**
 * Delete a bookmark from the Cervo API by searching for its URL first.
 * Fire-and-forget -- local delete is the source of truth.
 */
export async function apiDeleteBookmark(url: string): Promise<void> {
  const config = getApiConfig();
  if (!config) return;

  try {
    // Find the bookmark ID by searching for the URL
    const params = new URLSearchParams({
      workspaceId: config.workspaceId,
      memberId: config.memberId,
      text: url,
      limit: "5",
    });

    const searchResponse = await fetch(`${config.apiUrl}/bookmarks?${params}`, {
      headers: { "X-API-Key": config.apiKey },
    });

    if (!searchResponse.ok) return;
    const bookmarks = (await searchResponse.json()) as ApiBookmark[];
    const match = bookmarks.find((b) => b.url === url);
    if (!match) return;

    await fetch(`${config.apiUrl}/bookmarks/${match.id}`, {
      method: "DELETE",
      headers: { "X-API-Key": config.apiKey },
    });
  } catch {
    // Silently fail
  }
}

/**
 * Retry processing a failed bookmark, or re-submit if not found in API.
 * Returns true on success.
 */
export async function apiRetryBookmark(url: string): Promise<boolean> {
  const config = getApiConfig();
  if (!config) return false;

  try {
    // Find the bookmark by URL
    const params = new URLSearchParams({
      workspaceId: config.workspaceId,
      memberId: config.memberId,
      text: url,
      limit: "5",
    });

    const searchResponse = await fetch(`${config.apiUrl}/bookmarks?${params}`, {
      headers: { "X-API-Key": config.apiKey },
    });

    if (searchResponse.ok) {
      const bookmarks = (await searchResponse.json()) as ApiBookmark[];
      const match = bookmarks.find((b) => b.url === url);

      if (match && match.status === "failed") {
        // Retry the failed bookmark
        const retryResponse = await fetch(`${config.apiUrl}/bookmarks/${match.id}/retry`, {
          method: "POST",
          headers: { "X-API-Key": config.apiKey },
        });
        return retryResponse.ok;
      }
    }

    // Not found or not in failed state -- re-submit as new
    const response = await fetch(`${config.apiUrl}/bookmarks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": config.apiKey,
      },
      body: JSON.stringify({
        workspaceId: config.workspaceId,
        memberId: config.memberId,
        url,
        source: "raycast",
      }),
    });
    return response.ok || response.status === 201;
  } catch {
    return false;
  }
}

/**
 * Check if the API is configured.
 */
export function isApiConfigured(): boolean {
  return getApiConfig() !== null;
}
