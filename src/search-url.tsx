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
import { useEffect, useRef, useState } from "react";
import { getDbPath, initDatabase, deleteUrl, saveUrl, buildSearchQuery } from "./lib/db";
import { apiSaveBookmark, apiSearchBookmarks, isApiConfigured } from "./lib/api";
import { looksLikeUrl } from "./lib/url";
import { relativeTime } from "./lib/time";
import { UrlEntry, ApiBookmark, Preferences } from "./lib/types";

interface DisplayItem {
  key: string;
  url: string;
  title: string;
  subtitle?: string;
  timeText: string;
  matchedBecause?: string;
  localId?: number;
  source: "local" | "api";
}

function localToDisplayItem(entry: UrlEntry): DisplayItem {
  return {
    key: `local-${entry.id}`,
    url: entry.url,
    title: entry.url,
    timeText: relativeTime(entry.created_at),
    localId: entry.id,
    source: "local",
  };
}

function apiToDisplayItem(bookmark: ApiBookmark): DisplayItem {
  return {
    key: `api-${bookmark.id}`,
    url: bookmark.url,
    title: bookmark.title || bookmark.url,
    subtitle: bookmark.description,
    timeText: relativeTime(bookmark.createdAt),
    matchedBecause: bookmark.matchedBecause,
    source: "api",
  };
}

function mergeResults(localItems: DisplayItem[], apiItems: DisplayItem[]): DisplayItem[] {
  const seenUrls = new Set(localItems.map((item) => item.url));
  const uniqueApiItems = apiItems.filter((item) => !seenUrls.has(item.url));
  return [...localItems, ...uniqueApiItems];
}

export default function Command() {
  const prefs = getPreferenceValues<Preferences>();
  const [searchText, setSearchText] = useState("");
  const clipboardChecked = useRef(false);
  const [apiResults, setApiResults] = useState<DisplayItem[]>([]);
  const [apiLoading, setApiLoading] = useState(false);

  // Ensure database exists before querying
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
        // Sync to API in background
        apiSaveBookmark(result.url);
        revalidate();
      }
    })();
  }, []);

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
      revalidate();
    }
  }

  const localItems = (data || []).map(localToDisplayItem);
  const items = searchText.trim() ? mergeResults(localItems, apiResults) : localItems;

  return (
    <List
      isLoading={isLoading || apiLoading}
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
            subtitle={item.matchedBecause}
            accessories={[
              ...(item.source === "api" && item.title !== item.url ? [{ tag: "AI" }] : []),
              { text: item.timeText },
            ]}
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
