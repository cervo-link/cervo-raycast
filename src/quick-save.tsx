import { Clipboard, showHUD, showToast, Toast, getPreferenceValues } from "@raycast/api";
import { saveUrl } from "./lib/db";
import { apiSaveBookmark, isApiConfigured } from "./lib/api";
import { looksLikeUrl } from "./lib/url";
import { Preferences } from "./lib/types";

export default async function Command() {
  const prefs = getPreferenceValues<Preferences>();

  const clipboardText = await Clipboard.readText();
  if (!clipboardText || !looksLikeUrl(clipboardText)) {
    await showHUD("No valid URL in clipboard");
    return;
  }

  const result = saveUrl(clipboardText);

  switch (result.type) {
    case "saved": {
      const host = new URL(result.url).hostname;
      await showHUD(`Saved: ${host}`);
      if (prefs.clearClipboardAfterSave) {
        await Clipboard.clear();
      }
      // Sync to API in background with feedback
      if (isApiConfigured()) {
        const synced = await apiSaveBookmark(result.url);
        if (synced) {
          await showToast({ style: Toast.Style.Success, title: "Synced to Cervo API", message: host });
        } else {
          await showToast({ style: Toast.Style.Failure, title: "API sync failed", message: "Saved locally only" });
        }
      }
      break;
    }
    case "duplicate": {
      const host = new URL(result.url).hostname;
      await showHUD(`Already saved: ${host}`);
      break;
    }
    case "invalid":
      await showHUD("Invalid URL in clipboard");
      break;
  }
}
