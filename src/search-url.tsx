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
import { looksLikeUrl } from "./lib/url";
import { relativeTime } from "./lib/time";
import { UrlEntry, Preferences } from "./lib/types";

export default function Command() {
  const prefs = getPreferenceValues<Preferences>();
  const [searchText, setSearchText] = useState("");
  const clipboardChecked = useRef(false);

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
        revalidate();
      }
    })();
  }, []);

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
      deleteUrl(entry.id);
      await showToast({ style: Toast.Style.Success, title: "Deleted", message: entry.url });
      revalidate();
    }
  }

  const urls = data || [];

  return (
    <List
      isLoading={isLoading}
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
                <Action.OpenInBrowser url={entry.url} onOpen={prefs.closeAfterAction ? () => popToRoot() : undefined} />
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
