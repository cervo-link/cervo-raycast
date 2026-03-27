import { environment } from "@raycast/api";
import { executeSQL } from "@raycast/utils";
import path from "path";
import { normalizeUrl } from "./url";
import { UrlEntry, SaveResult } from "./types";

const DB_PATH = path.join(environment.supportPath, "cervo.db");

export function getDbPath(): string {
  return DB_PATH;
}

export async function initDatabase(): Promise<void> {
  await executeSQL(DB_PATH, `
    CREATE TABLE IF NOT EXISTS urls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await executeSQL(DB_PATH, `
    CREATE INDEX IF NOT EXISTS idx_urls_created_at ON urls(created_at DESC)
  `);
}

export async function saveUrl(raw: string): Promise<SaveResult> {
  const normalized = normalizeUrl(raw);
  if (!normalized) {
    return { type: "invalid" };
  }

  await initDatabase();

  // Try to insert; INSERT OR IGNORE silently skips duplicates
  await executeSQL(DB_PATH, `INSERT OR IGNORE INTO urls (url) VALUES ('${normalized.replace(/'/g, "''")}')`);

  // Check if this URL exists (either just inserted or already existed)
  const rows = await executeSQL<{ id: number; url: string }>(
    DB_PATH,
    `SELECT id, url FROM urls WHERE url = '${normalized.replace(/'/g, "''")}'`
  );

  if (rows.length === 0) {
    return { type: "invalid" };
  }

  // Determine if it was a new insert by checking if created_at is very recent (within last 2 seconds)
  const check = await executeSQL<{ is_new: number }>(
    DB_PATH,
    `SELECT (julianday('now') - julianday(created_at)) * 86400 < 2 AS is_new FROM urls WHERE id = ${rows[0].id}`
  );

  const isNew = check.length > 0 && check[0].is_new === 1;

  return isNew
    ? { type: "saved", id: rows[0].id, url: rows[0].url }
    : { type: "duplicate", id: rows[0].id, url: rows[0].url };
}

export async function deleteUrl(id: number): Promise<void> {
  await initDatabase();
  await executeSQL(DB_PATH, `DELETE FROM urls WHERE id = ${id}`);
}

/**
 * Builds the SQL query string for useSQL hook.
 * useSQL needs the raw query; it handles execution internally.
 */
export function buildSearchQuery(query?: string): string {
  if (!query || query.trim() === "") {
    return "SELECT id, url, created_at FROM urls ORDER BY created_at DESC LIMIT 100";
  }
  const escaped = query.replace(/'/g, "''");
  return `SELECT id, url, created_at FROM urls WHERE url LIKE '%${escaped}%' ORDER BY created_at DESC LIMIT 100`;
}
