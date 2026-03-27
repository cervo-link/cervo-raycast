export interface UrlEntry {
  id: number;
  url: string;
  title: string | null;
  description: string | null;
  tags: string | null;
  created_at: string;
}

export interface ApiBookmark {
  id: string;
  url: string;
  title?: string;
  description?: string;
  tags?: string[];
  status: string;
  createdAt: string;
  matchedBecause?: string;
}

export type SaveResult =
  | { type: "saved"; id: number; url: string }
  | { type: "duplicate"; id: number; url: string }
  | { type: "invalid" };

export interface Preferences {
  autoSaveClipboard: boolean;
  clearClipboardAfterSave: boolean;
  closeAfterAction: boolean;
  apiUrl?: string;
  apiKey?: string;
  workspaceId?: string;
  memberId?: string;
}
