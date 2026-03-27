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

  // Check if old table with UNIQUE(url) exists and migrate it
  const tableInfo = runSQL<{ sql: string }>(`SELECT sql FROM sqlite_master WHERE type='table' AND name='urls';`);
  const needsRecreate = tableInfo.length > 0 && tableInfo[0].sql.includes("url TEXT NOT NULL UNIQUE");

  if (needsRecreate) {
    // Recreate table without the old UNIQUE(url) constraint
    runSQL(`
      CREATE TABLE IF NOT EXISTS urls_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        workspace_id TEXT,
        title TEXT,
        description TEXT,
        tags TEXT,
        api_status TEXT,
        api_bookmark_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO urls_new (id, url, workspace_id, title, description, tags, api_status, api_bookmark_id, created_at)
        SELECT id, url, workspace_id, title, description, tags, api_status, api_bookmark_id, created_at FROM urls;
      DROP TABLE urls;
      ALTER TABLE urls_new RENAME TO urls;
    `);
  } else {
    // Fresh install
    runSQL(`
      CREATE TABLE IF NOT EXISTS urls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        workspace_id TEXT,
        title TEXT,
        description TEXT,
        tags TEXT,
        api_status TEXT,
        api_bookmark_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  // Indexes
  runSQL(`CREATE INDEX IF NOT EXISTS idx_urls_created_at ON urls(created_at DESC);`);
  runSQL(`CREATE INDEX IF NOT EXISTS idx_urls_workspace ON urls(workspace_id);`);
  try {
    runSQL(`CREATE UNIQUE INDEX IF NOT EXISTS idx_urls_url_workspace ON urls(url, workspace_id);`);
  } catch {
    /* already exists */
  }
  dbInitialized = true;
}

export function saveUrl(raw: string, workspaceId?: string): SaveResult {
  const normalized = normalizeUrl(raw);
  if (!normalized) {
    return { type: "invalid" };
  }

  initDatabase();

  const escaped = normalized.replace(/'/g, "''");
  const wsId = workspaceId ? `'${workspaceId.replace(/'/g, "''")}'` : "NULL";
  const wsCondition = workspaceId ? `workspace_id = '${workspaceId.replace(/'/g, "''")}'` : "workspace_id IS NULL";

  runSQL(`INSERT OR IGNORE INTO urls (url, workspace_id) VALUES ('${escaped}', ${wsId})`);

  const rows = runSQL<{ id: number; url: string }>(
    `SELECT id, url FROM urls WHERE url = '${escaped}' AND ${wsCondition}`,
  );

  if (rows.length === 0) {
    return { type: "invalid" };
  }

  const check = runSQL<{ is_new: number }>(
    `SELECT (julianday('now') - julianday(created_at)) * 86400 < 2 AS is_new FROM urls WHERE id = ${rows[0].id}`,
  );

  const isNew = check.length > 0 && check[0].is_new === 1;

  return isNew
    ? { type: "saved", id: rows[0].id, url: rows[0].url }
    : { type: "duplicate", id: rows[0].id, url: rows[0].url };
}

export function enrichUrl(
  url: string,
  title: string | undefined,
  description: string | undefined,
  tags: string[] | undefined,
  apiStatus: string,
  apiBookmarkId?: string,
  workspaceId?: string,
): void {
  initDatabase();
  const escapedUrl = url.replace(/'/g, "''");
  const escapedTitle = title ? `'${title.replace(/'/g, "''")}'` : "NULL";
  const escapedDesc = description ? `'${description.replace(/'/g, "''")}'` : "NULL";
  const escapedTags = tags && tags.length > 0 ? `'${tags.join(",").replace(/'/g, "''")}'` : "NULL";
  const escapedStatus = `'${apiStatus.replace(/'/g, "''")}'`;
  const escapedBookmarkId = apiBookmarkId ? `'${apiBookmarkId.replace(/'/g, "''")}'` : "NULL";
  const wsCondition = workspaceId ? `workspace_id = '${workspaceId.replace(/'/g, "''")}'` : "1=1";
  runSQL(
    `UPDATE urls SET title = ${escapedTitle}, description = ${escapedDesc}, tags = ${escapedTags}, api_status = ${escapedStatus}, api_bookmark_id = COALESCE(${escapedBookmarkId}, api_bookmark_id) WHERE url = '${escapedUrl}' AND ${wsCondition}`,
  );
}

/**
 * Assign all URLs with no workspace to the given workspace.
 * Also dedupes: if a URL already exists in the target workspace, delete the orphan.
 */
export function migrateOrphanedUrls(workspaceId: string): void {
  initDatabase();
  const escaped = workspaceId.replace(/'/g, "''");
  // Delete orphans that already exist in the target workspace
  runSQL(
    `DELETE FROM urls WHERE (workspace_id IS NULL OR workspace_id = '') AND url IN (SELECT url FROM urls WHERE workspace_id = '${escaped}')`,
  );
  // Assign remaining orphans
  runSQL(`UPDATE urls SET workspace_id = '${escaped}' WHERE workspace_id IS NULL OR workspace_id = ''`);
}

export function deleteUrl(id: number): void {
  initDatabase();
  runSQL(`DELETE FROM urls WHERE id = ${id}`);
}

const SELECT_COLS = "id, url, workspace_id, title, description, tags, api_status, api_bookmark_id, created_at";

/**
 * Builds the SQL query string for useSQL hook (read-only).
 * workspaceIds: single ID, array of IDs, or undefined for all.
 */
export function buildSearchQuery(query?: string, workspaceIds?: string | string[]): string {
  let wsFilter = "";
  if (workspaceIds) {
    const ids = Array.isArray(workspaceIds) ? workspaceIds : [workspaceIds];
    const escaped = ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
    wsFilter = `workspace_id IN (${escaped})`;
  }

  if (!query || query.trim() === "") {
    const where = wsFilter ? `WHERE ${wsFilter}` : "";
    return `SELECT ${SELECT_COLS} FROM urls ${where} ORDER BY created_at DESC LIMIT 100`;
  }
  const escaped = query.replace(/'/g, "''");
  const textFilter = `(url LIKE '%${escaped}%' OR title LIKE '%${escaped}%' OR description LIKE '%${escaped}%')`;
  const where = wsFilter ? `WHERE ${wsFilter} AND ${textFilter}` : `WHERE ${textFilter}`;
  return `SELECT ${SELECT_COLS} FROM urls ${where} ORDER BY created_at DESC LIMIT 100`;
}
