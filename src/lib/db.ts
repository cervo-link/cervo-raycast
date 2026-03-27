import { environment } from "@raycast/api";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { normalizeUrl } from "./url";
import { SaveResult } from "./types";

const DB_PATH = path.join(environment.supportPath, "cervo.db");

export function getDbPath(): string {
  return DB_PATH;
}

/**
 * Run a write (or read) SQL query using sqlite3 CLI directly.
 * executeSQL from @raycast/utils opens databases read-only,
 * so we need this for CREATE TABLE, INSERT, DELETE operations.
 */
function runSQL<T = Record<string, unknown>>(query: string): T[] {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const result = execFileSync("/usr/bin/sqlite3", ["-json", DB_PATH, query], {
    encoding: "utf-8",
    timeout: 5000,
  });
  const trimmed = result.trim();
  if (!trimmed) return [];
  return JSON.parse(trimmed) as T[];
}

let dbInitialized = false;

export function initDatabase(): void {
  if (dbInitialized) return;
  runSQL(`
    CREATE TABLE IF NOT EXISTS urls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      title TEXT,
      description TEXT,
      tags TEXT,
      api_status TEXT,
      api_bookmark_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_urls_created_at ON urls(created_at DESC);
  `);
  // Migrate: add columns if they don't exist (for existing databases)
  const migrations = ["title TEXT", "description TEXT", "tags TEXT", "api_status TEXT", "api_bookmark_id TEXT"];
  for (const col of migrations) {
    try {
      runSQL(`ALTER TABLE urls ADD COLUMN ${col};`);
    } catch {
      /* column already exists */
    }
  }
  dbInitialized = true;
}

export function saveUrl(raw: string): SaveResult {
  const normalized = normalizeUrl(raw);
  if (!normalized) {
    return { type: "invalid" };
  }

  initDatabase();

  const escaped = normalized.replace(/'/g, "''");

  // Try to insert; INSERT OR IGNORE silently skips duplicates
  runSQL(`INSERT OR IGNORE INTO urls (url) VALUES ('${escaped}')`);

  // Check if this URL exists (either just inserted or already existed)
  const rows = runSQL<{ id: number; url: string }>(`SELECT id, url FROM urls WHERE url = '${escaped}'`);

  if (rows.length === 0) {
    return { type: "invalid" };
  }

  // Determine if it was a new insert by checking if created_at is very recent (within last 2 seconds)
  const check = runSQL<{ is_new: number }>(
    `SELECT (julianday('now') - julianday(created_at)) * 86400 < 2 AS is_new FROM urls WHERE id = ${rows[0].id}`,
  );

  const isNew = check.length > 0 && check[0].is_new === 1;

  return isNew
    ? { type: "saved", id: rows[0].id, url: rows[0].url }
    : { type: "duplicate", id: rows[0].id, url: rows[0].url };
}

/**
 * Update a local URL entry with enriched data and status from the API.
 */
export function enrichUrl(
  url: string,
  title: string | undefined,
  description: string | undefined,
  tags: string[] | undefined,
  apiStatus: string,
  apiBookmarkId?: string,
): void {
  initDatabase();
  const escapedUrl = url.replace(/'/g, "''");
  const escapedTitle = title ? `'${title.replace(/'/g, "''")}'` : "NULL";
  const escapedDesc = description ? `'${description.replace(/'/g, "''")}'` : "NULL";
  const escapedTags = tags && tags.length > 0 ? `'${tags.join(",").replace(/'/g, "''")}'` : "NULL";
  const escapedStatus = `'${apiStatus.replace(/'/g, "''")}'`;
  const escapedBookmarkId = apiBookmarkId ? `'${apiBookmarkId.replace(/'/g, "''")}'` : "NULL";
  runSQL(
    `UPDATE urls SET title = ${escapedTitle}, description = ${escapedDesc}, tags = ${escapedTags}, api_status = ${escapedStatus}, api_bookmark_id = COALESCE(${escapedBookmarkId}, api_bookmark_id) WHERE url = '${escapedUrl}'`,
  );
}

export function deleteUrl(id: number): void {
  initDatabase();
  runSQL(`DELETE FROM urls WHERE id = ${id}`);
}

/**
 * Builds the SQL query string for useSQL hook (read-only).
 * useSQL needs the raw query; it handles execution internally.
 */
export function buildSearchQuery(query?: string): string {
  if (!query || query.trim() === "") {
    return "SELECT id, url, title, description, tags, api_status, api_bookmark_id, created_at FROM urls ORDER BY created_at DESC LIMIT 100";
  }
  const escaped = query.replace(/'/g, "''");
  return `SELECT id, url, title, description, tags, api_status, api_bookmark_id, created_at FROM urls WHERE url LIKE '%${escaped}%' OR title LIKE '%${escaped}%' OR description LIKE '%${escaped}%' ORDER BY created_at DESC LIMIT 100`;
}
