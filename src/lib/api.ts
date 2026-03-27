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
 * Save a bookmark to the Cervo API (fire-and-forget).
 * Returns silently on failure -- local save is the source of truth.
 */
export async function apiSaveBookmark(url: string): Promise<void> {
  const config = getApiConfig();
  if (!config) return;

  try {
    await fetch(`${config.apiUrl}/bookmarks`, {
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
  } catch {
    // Silently fail -- local save is the source of truth
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
 * Check if the API is configured.
 */
export function isApiConfigured(): boolean {
  return getApiConfig() !== null;
}
