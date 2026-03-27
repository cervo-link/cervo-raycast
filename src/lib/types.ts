export interface UrlEntry {
  id: number;
  url: string;
  created_at: string;
}

export type SaveResult =
  | { type: "saved"; id: number; url: string }
  | { type: "duplicate"; id: number; url: string }
  | { type: "invalid" };

export interface Preferences {
  autoSaveClipboard: boolean;
  clearClipboardAfterSave: boolean;
  closeAfterAction: boolean;
}
