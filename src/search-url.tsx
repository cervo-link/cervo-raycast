import {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
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
import { useEffect, useRef, useState } from "react";
import { getDbPath, initDatabase, deleteUrl, saveUrl, enrichUrl, buildSearchQuery } from "./lib/db";
import {
  apiSaveBookmark,
  apiSearchBookmarks,
  apiFetchEnrichedData,
  apiDeleteBookmark,
  isApiConfigured,
} from "./lib/api";
import { looksLikeUrl } from "./lib/url";
import { relativeTime } from "./lib/time";
import { UrlEntry, ApiBookmark, Preferences } from "./lib/types";

type ItemStatus = "ready" | "processing" | "failed" | "local";

interface DisplayItem {
  key: string;
  url: string;
  title: string;
  description?: string;
  tags?: string[];
  timeText: string;
  matchedBecause?: string;
  localId?: number;
  source: "local" | "api";
  status: ItemStatus;
}

function getStatusColor(status: ItemStatus): Color {
  switch (status) {
    case "ready":
      return Color.Green;
    case "processing":
      return Color.Yellow;
    case "failed":
      return Color.Red;
    case "local":
      return Color.SecondaryText;
  }
}

function getStatusIcon(status: ItemStatus): { source: Icon; tintColor: Color } {
  return { source: Icon.CircleFilled, tintColor: getStatusColor(status) };
}

function resolveStatus(entry: UrlEntry, apiConfigured: boolean): ItemStatus {
  const apiStatus = entry.api_status;
  if (apiStatus === "ready") return "ready";
  if (apiStatus === "failed") return "failed";
  if (apiStatus === "processing" || apiStatus === "submitted") return "processing";
  // No api_status stored yet -- infer from data
  if (entry.title) return "ready";
  if (apiConfigured) return "processing";
  return "local";
}

function localToDisplayItem(entry: UrlEntry, apiConfigured: boolean): DisplayItem {
  const tags = entry.tags ? entry.tags.split(",").filter(Boolean) : undefined;
  const status = resolveStatus(entry, apiConfigured);

  return {
    key: `local-${entry.id}`,
    url: entry.url,
    title: entry.title || entry.url,
    description: entry.description || undefined,
    tags,
    timeText: relativeTime(entry.created_at),
    localId: entry.id,
    source: "local",
    status,
  };
}

function apiStatusToItemStatus(apiStatus: string): ItemStatus {
  if (apiStatus === "ready") return "ready";
  if (apiStatus === "failed") return "failed";
  if (apiStatus === "processing" || apiStatus === "submitted") return "processing";
  return "processing";
}

function apiToDisplayItem(bookmark: ApiBookmark): DisplayItem {
  return {
    key: `api-${bookmark.id}`,
    url: bookmark.url,
    title: bookmark.title || bookmark.url,
    description: bookmark.description,
    tags: bookmark.tags,
    timeText: relativeTime(bookmark.createdAt),
    matchedBecause: bookmark.matchedBecause,
    source: "api",
    status: apiStatusToItemStatus(bookmark.status),
  };
}

function mergeAndEnrich(localItems: DisplayItem[], apiItems: DisplayItem[]): DisplayItem[] {
  const apiByUrl = new Map(apiItems.map((item) => [item.url, item]));

  // Enrich local items with API data and cache it to SQLite
  const enrichedLocal = localItems.map((local) => {
    const apiMatch = apiByUrl.get(local.url);
    if (apiMatch) {
      // Cache enriched data and status locally
      enrichUrl(
        local.url,
        apiMatch.title !== apiMatch.url ? apiMatch.title : undefined,
        apiMatch.description,
        apiMatch.tags,
        apiMatch.status,
      );
      return {
        ...local,
        title: apiMatch.title,
        description: apiMatch.description,
        tags: apiMatch.tags,
        matchedBecause: apiMatch.matchedBecause,
        status: apiMatch.status,
      };
    }
    return local;
  });

  // Add API-only items
  const seenUrls = new Set(localItems.map((item) => item.url));
  const uniqueApiItems = apiItems.filter((item) => !seenUrls.has(item.url));

  return [...enrichedLocal, ...uniqueApiItems];
}

function buildDetailMarkdown(item: DisplayItem): string {
  const parts: string[] = [];

  if (item.title !== item.url) {
    parts.push(`# ${item.title}`);
  }

  parts.push(`**URL:** ${item.url}`);

  if (item.description) {
    parts.push(`\n${item.description}`);
  }

  if (item.tags && item.tags.length > 0) {
    parts.push(`\n**Tags:** ${item.tags.join(", ")}`);
  }

  if (item.matchedBecause) {
    parts.push(`\n**Matched because:** ${item.matchedBecause}`);
  }

  return parts.join("\n");
}

export default function Command() {
  const prefs = getPreferenceValues<Preferences>();
  const [searchText, setSearchText] = useState("");
  const clipboardChecked = useRef(false);
  const [apiResults, setApiResults] = useState<DisplayItem[]>([]);
  const [apiLoading, setApiLoading] = useState(false);

  initDatabase();

  const query = buildSearchQuery(searchText);
  const { data, isLoading, revalidate } = useSQL<UrlEntry>(getDbPath(), query);

  // Auto-save clipboard URL on launch
  useEffect(() => {
    if (clipboardChecked.current || !prefs.autoSaveClipboard) return;
    clipboardChecked.current = true;

    (async () => {
      const text = await Clipboard.readText();
      if (!text || !looksLikeUrl(text)) return;

      const result = saveUrl(text);
      if (result.type === "saved") {
        const host = new URL(result.url).hostname;
        await showToast({ style: Toast.Style.Success, title: "Saved from clipboard", message: host });
        if (prefs.clearClipboardAfterSave) {
          await Clipboard.clear();
        }
        apiSaveBookmark(result.url);
        revalidate();
      }
    })();
  }, []);

  // Background enrichment: fetch API data for local items missing titles
  const enrichmentDone = useRef(false);
  useEffect(() => {
    if (enrichmentDone.current || !data || data.length === 0 || !isApiConfigured()) return;
    const needsUpdate = data.filter(
      (entry) => !entry.api_status || entry.api_status === "submitted" || entry.api_status === "processing",
    );
    if (needsUpdate.length === 0) {
      enrichmentDone.current = true;
      return;
    }
    enrichmentDone.current = true;

    (async () => {
      const urls = needsUpdate.map((e) => e.url);
      const apiBookmarks = await apiFetchEnrichedData(urls);
      const apiByUrl = new Map(apiBookmarks.map((b) => [b.url, b]));

      let updated = false;
      for (const entry of needsUpdate) {
        const match = apiByUrl.get(entry.url);
        if (match) {
          enrichUrl(
            entry.url,
            match.title && match.title !== match.url ? match.title : undefined,
            match.description,
            match.tags,
            match.status,
          );
          updated = true;
        }
      }
      if (updated) revalidate();
    })();
  }, [data]);

  // Background API search when query changes
  useEffect(() => {
    if (!searchText.trim() || !isApiConfigured()) {
      setApiResults([]);
      return;
    }

    let cancelled = false;
    setApiLoading(true);

    apiSearchBookmarks(searchText).then((bookmarks) => {
      if (!cancelled) {
        setApiResults(bookmarks.map(apiToDisplayItem));
        setApiLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [searchText]);

  async function handleDelete(item: DisplayItem) {
    if (!item.localId) return;

    const confirmed = await confirmAlert({
      title: "Delete URL",
      message: `Are you sure you want to delete ${item.url}?`,
      primaryAction: {
        title: "Delete",
        style: Alert.ActionStyle.Destructive,
      },
    });

    if (confirmed) {
      deleteUrl(item.localId);
      await showToast({ style: Toast.Style.Success, title: "Deleted", message: item.url });
      // Sync delete to API in background
      apiDeleteBookmark(item.url);
      revalidate();
    }
  }

  const apiConfigured = isApiConfigured();
  const localItems = (data || []).map((entry) => localToDisplayItem(entry, apiConfigured));
  const items = searchText.trim() ? mergeAndEnrich(localItems, apiResults) : localItems;

  return (
    <List
      isLoading={isLoading || apiLoading}
      isShowingDetail
      searchBarPlaceholder="Search saved URLs..."
      onSearchTextChange={setSearchText}
      filtering={false}
      throttle
    >
      {items.length === 0 && !isLoading && !apiLoading ? (
        <List.EmptyView title="No saved URLs yet" description="Use Quick Save to add URLs" icon={Icon.Globe} />
      ) : (
        items.map((item) => (
          <List.Item
            key={item.key}
            title={item.title}
            accessories={[{ icon: getStatusIcon(item.status) }, { text: item.timeText }]}
            detail={
              <List.Item.Detail
                markdown={buildDetailMarkdown(item)}
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Link title="URL" target={item.url} text={item.url} />
                    <List.Item.Detail.Metadata.Label title="Saved" text={item.timeText} />
                    {item.tags && item.tags.length > 0 && (
                      <List.Item.Detail.Metadata.TagList title="Tags">
                        {item.tags.map((tag) => (
                          <List.Item.Detail.Metadata.TagList.Item key={tag} text={tag} />
                        ))}
                      </List.Item.Detail.Metadata.TagList>
                    )}
                    {item.matchedBecause && (
                      <List.Item.Detail.Metadata.Label title="Match" text={item.matchedBecause} />
                    )}
                  </List.Item.Detail.Metadata>
                }
              />
            }
            actions={
              <ActionPanel>
                <Action.OpenInBrowser url={item.url} onOpen={prefs.closeAfterAction ? () => popToRoot() : undefined} />
                <Action.CopyToClipboard
                  content={item.url}
                  shortcut={Keyboard.Shortcut.Common.Copy}
                  onCopy={prefs.closeAfterAction ? () => popToRoot() : undefined}
                />
                {item.localId && (
                  <Action
                    title="Delete URL"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    shortcut={Keyboard.Shortcut.Common.Remove}
                    onAction={() => handleDelete(item)}
                  />
                )}
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}
