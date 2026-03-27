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
 * Fetch enriched data for a list of URLs by searching the API for each.
 * Used to backfill local items that don't have titles yet.
 * Returns all bookmarks found.
 */
export async function apiFetchEnrichedData(urls: string[]): Promise<ApiBookmark[]> {
  const config = getApiConfig();
  if (!config || urls.length === 0) return [];

  const results: ApiBookmark[] = [];

  // Search for each URL's hostname to find its enriched data
  const uniqueHosts = [
    ...new Set(
      urls
        .map((url) => {
          try {
            return new URL(url).hostname.replace("www.", "");
          } catch {
            return null;
          }
        })
        .filter(Boolean),
    ),
  ] as string[];

  for (const host of uniqueHosts) {
    try {
      const params = new URLSearchParams({
        workspaceId: config.workspaceId,
        memberId: config.memberId,
        text: host,
        limit: "50",
      });

      const response = await fetch(`${config.apiUrl}/bookmarks?${params}`, {
        headers: { "X-API-Key": config.apiKey },
      });

      if (response.ok) {
        const bookmarks = (await response.json()) as ApiBookmark[];
        results.push(...bookmarks);
      }
    } catch {
      // continue with next host
    }
  }

  return results;
}

/**
 * Check if the API is configured.
 */
export function isApiConfigured(): boolean {
  return getApiConfig() !== null;
}
