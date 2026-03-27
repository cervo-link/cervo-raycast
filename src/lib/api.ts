import { getPreferenceValues } from "@raycast/api";
import { Preferences, ApiBookmark, Workspace } from "./types";

interface ApiConfig {
  apiUrl: string;
  apiKey: string;
  memberId: string;
}

export function getApiConfig(): ApiConfig | null {
  const prefs = getPreferenceValues<Preferences>();
  if (!prefs.apiUrl || !prefs.apiKey || !prefs.memberId) {
    return null;
  }
  return {
    apiUrl: prefs.apiUrl.replace(/\/$/, ""),
    apiKey: prefs.apiKey,
    memberId: prefs.memberId,
  };
}

export function isApiConfigured(): boolean {
  return getApiConfig() !== null;
}

/**
 * Fetch workspaces for the configured member.
 */
export async function apiFetchWorkspaces(): Promise<Workspace[]> {
  const config = getApiConfig();
  if (!config) return [];

  try {
    const response = await fetch(`${config.apiUrl}/workspaces/by-member/${config.memberId}`, {
      headers: { "X-API-Key": config.apiKey },
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { workspaces: Workspace[] };
    return data.workspaces;
  } catch {
    return [];
  }
}

/**
 * Save a bookmark to the Cervo API.
 * Returns the API bookmark ID if synced successfully, null otherwise.
 */
export async function apiSaveBookmark(url: string, workspaceId: string): Promise<string | null> {
  const config = getApiConfig();
  if (!config) return null;

  try {
    const response = await fetch(`${config.apiUrl}/bookmarks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": config.apiKey,
      },
      body: JSON.stringify({
        workspaceId,
        memberId: config.memberId,
        url,
        source: "raycast",
      }),
    });
    if (response.ok || response.status === 201) {
      const data = (await response.json()) as { id: string; status: string };
      return data.id;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Search bookmarks via the Cervo API (semantic vector search).
 */
export async function apiSearchBookmarks(text: string, workspaceId: string, limit = 10): Promise<ApiBookmark[]> {
  const config = getApiConfig();
  if (!config) return [];

  try {
    const params = new URLSearchParams({
      workspaceId,
      memberId: config.memberId,
      text,
      limit: String(limit),
    });

    const response = await fetch(`${config.apiUrl}/bookmarks?${params}`, {
      headers: { "X-API-Key": config.apiKey },
    });

    if (!response.ok) return [];
    return (await response.json()) as ApiBookmark[];
  } catch {
    return [];
  }
}

/**
 * Fetch enriched data for a list of URLs by searching the API.
 */
export async function apiFetchEnrichedData(urls: string[], workspaceId: string): Promise<ApiBookmark[]> {
  const config = getApiConfig();
  if (!config || urls.length === 0) return [];

  const results: ApiBookmark[] = [];
  const seen = new Set<string>();

  for (const url of urls) {
    try {
      const params = new URLSearchParams({
        workspaceId,
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
 */
export async function apiDeleteBookmark(url: string, workspaceId: string): Promise<void> {
  const config = getApiConfig();
  if (!config) return;

  try {
    const params = new URLSearchParams({
      workspaceId,
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
 * Retry processing a failed bookmark, or re-submit if not found.
 */
export async function apiRetryBookmark(url: string, workspaceId: string): Promise<boolean> {
  const config = getApiConfig();
  if (!config) return false;

  try {
    const params = new URLSearchParams({
      workspaceId,
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
        const retryResponse = await fetch(`${config.apiUrl}/bookmarks/${match.id}/retry`, {
          method: "POST",
          headers: { "X-API-Key": config.apiKey },
        });
        return retryResponse.ok;
      }
    }

    // Not found or not in failed state -- re-submit
    const response = await fetch(`${config.apiUrl}/bookmarks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": config.apiKey,
      },
      body: JSON.stringify({
        workspaceId,
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
