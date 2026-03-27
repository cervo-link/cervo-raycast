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
