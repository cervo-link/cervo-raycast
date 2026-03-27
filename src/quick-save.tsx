import { Clipboard, showHUD, getPreferenceValues } from "@raycast/api";
import { saveUrl } from "./lib/db";
import { apiSaveBookmark } from "./lib/api";
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
      // Sync to API in background (fire-and-forget)
      apiSaveBookmark(result.url);
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
