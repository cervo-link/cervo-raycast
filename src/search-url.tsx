import {
  List,
  Form,
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
  useNavigation,
  Keyboard,
} from "@raycast/api";
import { useSQL } from "@raycast/utils";
import { useEffect, useRef, useState } from "react";
import {
  getDbPath,
  initDatabase,
  deleteUrl,
  saveUrl,
  enrichUrl,
  buildSearchQuery,
  migrateOrphanedUrls,
} from "./lib/db";
import {
  apiSaveBookmark,
  apiSearchBookmarks,
  apiFetchEnrichedData,
  apiFetchWorkspaces,
  apiCreateWorkspace,
  apiDeleteBookmark,
  apiRetryBookmark,
  isApiConfigured,
} from "./lib/api";
import { looksLikeUrl, normalizeUrl } from "./lib/url";
import { relativeTime } from "./lib/time";
import { UrlEntry, ApiBookmark, Workspace, Preferences } from "./lib/types";

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
  apiBookmarkId?: string;
  workspaceId?: string;
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

function isOlderThan3Min(isoDate: string): boolean {
  const dateStr = isoDate.endsWith("Z") || isoDate.includes("+") ? isoDate : `${isoDate}Z`;
  return Date.now() - new Date(dateStr).getTime() > 3 * 60 * 1000;
}

function resolveStatus(entry: UrlEntry, apiConfigured: boolean): ItemStatus {
  const apiStatus = entry.api_status;
  if (apiStatus === "ready") return "ready";
  if (apiStatus === "failed") return "failed";
  if (apiStatus === "processing" || apiStatus === "submitted") {
    return isOlderThan3Min(entry.created_at) ? "failed" : "processing";
  }
  if (entry.title) return "ready";
  if (apiConfigured) {
    return isOlderThan3Min(entry.created_at) ? "failed" : "processing";
  }
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
    workspaceId: entry.workspace_id || undefined,
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
    apiBookmarkId: bookmark.id,
    source: "api",
    status: apiStatusToItemStatus(bookmark.status),
  };
}

function mergeAndEnrich(localItems: DisplayItem[], apiItems: DisplayItem[]): DisplayItem[] {
  const apiByUrl = new Map(apiItems.map((item) => [item.url, item]));

  const enrichedLocal = localItems.map((local) => {
    const apiMatch = apiByUrl.get(local.url);
    if (apiMatch) {
      enrichUrl(
        local.url,
        apiMatch.title !== apiMatch.url ? apiMatch.title : undefined,
        apiMatch.description,
        apiMatch.tags,
        apiMatch.status,
        apiMatch.apiBookmarkId,
        local.workspaceId,
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

  if (item.status === "failed") {
    parts.push(
      `\n---\n\n⚠️ **Processing failed**\n\nThis URL could not be processed by the API — it may be unreachable, blocked, or took too long to respond. You can retry with **Cmd+R**.`,
    );
  }

  if (item.status === "processing") {
    parts.push(
      `\n---\n\n⏳ **Processing...**\n\nThe API is scraping and summarizing this page. Title, description, and tags will appear once ready.`,
    );
  }

  return parts.join("\n");
}

const CREATE_WORKSPACE_VALUE = "__create__";
const ALL_WORKSPACES_VALUE = "__all__";

function WorkspaceDropdown(props: {
  workspaces: Workspace[];
  apiConfigured: boolean;
  onWorkspaceChange: (workspaceId: string) => void;
}) {
  if (!props.apiConfigured) {
    return (
      <List.Dropdown tooltip="Workspace" storeValue onChange={() => {}}>
        <List.Dropdown.Item title="Configure API to use workspaces" value="" />
      </List.Dropdown>
    );
  }

  if (props.workspaces.length === 0) {
    return (
      <List.Dropdown tooltip="Workspace" storeValue onChange={() => {}}>
        <List.Dropdown.Item title="Loading workspaces..." value="" />
      </List.Dropdown>
    );
  }

  return (
    <List.Dropdown tooltip="Workspace" storeValue onChange={props.onWorkspaceChange}>
      <List.Dropdown.Section>
        <List.Dropdown.Item title="All Workspaces" value={ALL_WORKSPACES_VALUE} icon={Icon.Globe} />
        {props.workspaces.map((ws) => (
          <List.Dropdown.Item key={ws.id} title={ws.name} value={ws.id} />
        ))}
      </List.Dropdown.Section>
      <List.Dropdown.Section>
        <List.Dropdown.Item title="+ Create Workspace" value={CREATE_WORKSPACE_VALUE} icon={Icon.PlusCircle} />
      </List.Dropdown.Section>
    </List.Dropdown>
  );
}

function CreateWorkspaceForm(props: { onCreate: (name: string, description?: string) => void }) {
  const [nameError, setNameError] = useState<string | undefined>();

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Create Workspace"
            onSubmit={(values: { name: string; description: string }) => {
              if (!values.name.trim()) {
                setNameError("Name is required");
                return;
              }
              props.onCreate(values.name.trim(), values.description.trim() || undefined);
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="name"
        title="Name"
        placeholder="My Workspace"
        error={nameError}
        onChange={() => setNameError(undefined)}
      />
      <Form.TextField id="description" title="Description" placeholder="Optional description" />
    </Form>
  );
}

export default function Command() {
  const prefs = getPreferenceValues<Preferences>();
  const { push, pop } = useNavigation();
  const [searchText, setSearchText] = useState("");
  const clipboardChecked = useRef(false);
  const [apiResults, setApiResults] = useState<DisplayItem[]>([]);
  const [apiLoading, setApiLoading] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>("");
  const lastRealWorkspaceId = useRef<string>("");
  const apiConfigured = isApiConfigured();

  // Resolve workspace IDs for API queries (single ID or all IDs)
  const isAllWorkspaces = selectedWorkspaceId === ALL_WORKSPACES_VALUE;
  const queryWorkspaceIds = isAllWorkspaces ? workspaces.map((ws) => ws.id) : selectedWorkspaceId;
  const defaultWorkspaceId = isAllWorkspaces ? workspaces[0]?.id : selectedWorkspaceId || undefined;

  const pollCount = useRef(0);

  initDatabase();

  function handleWorkspaceChange(workspaceId: string) {
    if (workspaceId === CREATE_WORKSPACE_VALUE) {
      push(
        <CreateWorkspaceForm
          onCreate={async (name, description) => {
            const ws = await apiCreateWorkspace(name, description);
            if (ws) {
              setWorkspaces((prev) => [...prev, ws]);
              setSelectedWorkspaceId(ws.id);
              lastRealWorkspaceId.current = ws.id;
              await showToast({ style: Toast.Style.Success, title: "Workspace created", message: name });
              pop();
            } else {
              await showToast({ style: Toast.Style.Failure, title: "Failed to create workspace" });
            }
          }}
        />,
      );
      // Restore previous workspace selection so the dropdown doesn't stay on "__create__"
      if (lastRealWorkspaceId.current) {
        setSelectedWorkspaceId(lastRealWorkspaceId.current);
      }
    } else {
      setSelectedWorkspaceId(workspaceId);
      lastRealWorkspaceId.current = workspaceId;
      // Reset state so enrichment and search re-run for new workspace
      setApiResults([]);
      pollCount.current = 0;
    }
  }

  // Fetch workspaces on load and migrate orphaned URLs
  const orphansMigrated = useRef(false);
  useEffect(() => {
    if (!apiConfigured) return;
    apiFetchWorkspaces().then((ws) => {
      setWorkspaces(ws);
      // Assign orphaned URLs (no workspace) to the first workspace
      if (!orphansMigrated.current && ws.length > 0) {
        orphansMigrated.current = true;
        migrateOrphanedUrls(ws[0].id);
      }
    });
  }, []);

  const query = buildSearchQuery(
    searchText,
    isAllWorkspaces ? workspaces.map((ws) => ws.id) : selectedWorkspaceId || undefined,
  );
  const { data, isLoading, revalidate } = useSQL<UrlEntry>(getDbPath(), query);

  // Auto-save clipboard URL on launch
  useEffect(() => {
    if (clipboardChecked.current || !prefs.autoSaveClipboard) return;
    clipboardChecked.current = true;

    (async () => {
      const text = await Clipboard.readText();
      if (!text || !looksLikeUrl(text)) return;

      const result = saveUrl(text, defaultWorkspaceId);
      if (result.type === "saved") {
        const host = new URL(result.url).hostname;
        await showToast({ style: Toast.Style.Success, title: "Saved from clipboard", message: host });
        if (prefs.clearClipboardAfterSave) {
          await Clipboard.clear();
        }
        if (defaultWorkspaceId) {
          const apiBookmarkId = await apiSaveBookmark(result.url, defaultWorkspaceId);
          if (apiBookmarkId) {
            enrichUrl(result.url, undefined, undefined, undefined, "submitted", apiBookmarkId, defaultWorkspaceId);
          }
        }
        revalidate();
      }
    })();
  }, [selectedWorkspaceId]);

  // Poll API for processing items every 5 seconds until all resolved
  useEffect(() => {
    if (!data || data.length === 0 || !apiConfigured || !selectedWorkspaceId) return;

    async function pollEnrichment() {
      pollCount.current += 1;
      const needsUpdate = (data || []).filter(
        (entry) => !entry.api_status || entry.api_status === "submitted" || entry.api_status === "processing",
      );
      if (needsUpdate.length === 0) return false;

      const urls = needsUpdate.map((e) => e.url);
      const apiBookmarks = await apiFetchEnrichedData(urls, queryWorkspaceIds);
      const apiByUrl = new Map(apiBookmarks.map((b) => [b.url, b]));

      let updated = false;
      let stillProcessing = false;

      for (const entry of needsUpdate) {
        const match = apiByUrl.get(entry.url);
        if (match) {
          enrichUrl(
            entry.url,
            match.title && match.title !== match.url ? match.title : undefined,
            match.description,
            match.tags,
            match.status,
            match.id,
            entry.workspace_id || undefined,
          );
          updated = true;
          if (match.status === "submitted" || match.status === "processing") {
            stillProcessing = true;
          }
        } else if (pollCount.current >= 6) {
          enrichUrl(entry.url, undefined, undefined, undefined, "failed", undefined, entry.workspace_id || undefined);
          updated = true;
        } else {
          stillProcessing = true;
        }
      }

      if (updated) revalidate();
      return stillProcessing;
    }

    let timer: NodeJS.Timeout;
    let cancelled = false;

    pollEnrichment().then((stillProcessing) => {
      if (cancelled || !stillProcessing) return;
      timer = setInterval(async () => {
        if (cancelled) return;
        const still = await pollEnrichment();
        if (!still && timer) clearInterval(timer);
      }, 5000);
    });

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [data, selectedWorkspaceId]);

  // Background API search when query changes
  useEffect(() => {
    if (!searchText.trim() || !apiConfigured || !selectedWorkspaceId) {
      setApiResults([]);
      return;
    }

    let cancelled = false;
    setApiLoading(true);

    apiSearchBookmarks(searchText, queryWorkspaceIds).then((bookmarks) => {
      if (!cancelled) {
        setApiResults(bookmarks.map(apiToDisplayItem));
        setApiLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [searchText, selectedWorkspaceId]);

  async function handleSaveFromSearch(url: string) {
    const result = saveUrl(url, defaultWorkspaceId);
    if (result.type === "saved") {
      const host = new URL(result.url).hostname;
      await showToast({ style: Toast.Style.Success, title: "Link saved", message: host });
      if (prefs.clearClipboardAfterSave) {
        await Clipboard.clear();
      }
      if (defaultWorkspaceId) {
        const apiBookmarkId = await apiSaveBookmark(result.url, defaultWorkspaceId);
        if (apiBookmarkId) {
          enrichUrl(result.url, undefined, undefined, undefined, "submitted", apiBookmarkId, defaultWorkspaceId);
        }
      }
      revalidate();
    } else if (result.type === "duplicate") {
      await showToast({ style: Toast.Style.Success, title: "Already saved", message: result.url });
    } else {
      await showToast({ style: Toast.Style.Failure, title: "Invalid URL" });
    }
  }

  async function handleRetry(item: DisplayItem) {
    if (!defaultWorkspaceId) return;
    await showToast({ style: Toast.Style.Animated, title: "Reprocessing...", message: item.url });
    if (item.localId) {
      enrichUrl(item.url, undefined, undefined, undefined, "processing", undefined, item.workspaceId);
    }
    revalidate();

    const success = await apiRetryBookmark(item.url, defaultWorkspaceId);
    if (success) {
      await showToast({ style: Toast.Style.Success, title: "Reprocessing started", message: item.url });
    } else {
      await showToast({ style: Toast.Style.Failure, title: "Reprocess failed", message: item.url });
    }
  }

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
      if (selectedWorkspaceId) {
        apiDeleteBookmark(item.url, defaultWorkspaceId);
      }
      revalidate();
    }
  }

  const localItems = (data || []).map((entry) => localToDisplayItem(entry, apiConfigured));
  const items = searchText.trim() ? mergeAndEnrich(localItems, apiResults) : localItems;

  const searchIsUrl = searchText.trim() && looksLikeUrl(searchText.trim()) && !!normalizeUrl(searchText.trim());

  return (
    <List
      isLoading={isLoading || apiLoading}
      isShowingDetail
      searchBarPlaceholder="Paste a URL to save or type to search..."
      onSearchTextChange={setSearchText}
      filtering={false}
      throttle
      searchBarAccessory={
        <WorkspaceDropdown
          workspaces={workspaces}
          apiConfigured={apiConfigured}
          onWorkspaceChange={handleWorkspaceChange}
        />
      }
    >
      {searchIsUrl && (
        <List.Item
          key="save-url"
          icon={{ source: Icon.PlusCircle, tintColor: Color.Blue }}
          title={`Save: ${searchText.trim()}`}
          detail={<List.Item.Detail markdown={`**Save this URL:**\n\n${normalizeUrl(searchText.trim())}`} />}
          actions={
            <ActionPanel>
              <Action
                title="Save URL"
                icon={Icon.PlusCircle}
                onAction={() => handleSaveFromSearch(searchText.trim())}
              />
            </ActionPanel>
          }
        />
      )}
      {items.length === 0 && !isLoading && !apiLoading && !searchIsUrl ? (
        <List.EmptyView
          title="No saved URLs yet"
          description="Paste a URL in the search bar to save it"
          icon={Icon.Globe}
        />
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
                    {item.workspaceId && (
                      <List.Item.Detail.Metadata.Label
                        title="Workspace"
                        text={workspaces.find((ws) => ws.id === item.workspaceId)?.name || item.workspaceId}
                      />
                    )}
                    {item.status === "failed" && (
                      <List.Item.Detail.Metadata.Label
                        title="Status"
                        text="Failed — Cmd+R to retry"
                        icon={{ source: Icon.CircleFilled, tintColor: Color.Red }}
                      />
                    )}
                    {item.status === "processing" && (
                      <List.Item.Detail.Metadata.Label
                        title="Status"
                        text="Processing..."
                        icon={{ source: Icon.CircleFilled, tintColor: Color.Yellow }}
                      />
                    )}
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
                {(item.status === "failed" || item.status === "processing") && apiConfigured && (
                  <Action
                    title="Reprocess URL"
                    icon={Icon.ArrowClockwise}
                    shortcut={{ modifiers: ["cmd"], key: "r" }}
                    onAction={() => handleRetry(item)}
                  />
                )}
                {item.localId && (
                  <Action
                    title="Delete URL"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    shortcut={{ modifiers: ["cmd"], key: "backspace" }}
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
