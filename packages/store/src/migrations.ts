import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { isoNow, systemClock, type Clock } from "@ir/core";

/**
 * Case database migrations (P1-013, ADR-04). Each migration runs once, inside its own transaction, in order; the
 * applied version is PRAGMA user_version and every applied migration's SQL checksum is kept in schema_migrations, so
 * a migration edited after release (drift) or a database from newer software is refused instead of silently used.
 * Released migrations are immutable: add a new one instead of editing.
 */
export type Migration = { version: number; name: string; sql: string };

const appendOnly = (table: string) => `
CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, '${table} is append-only'); END;
CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, '${table} is append-only'); END;`;

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "case-meta-and-ledger",
    sql: `
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE ledger (
  seq INTEGER PRIMARY KEY CHECK (seq >= 0),
  prev_hash TEXT CHECK (prev_hash IS NULL OR length(prev_hash) = 64),
  entry_hash TEXT NOT NULL UNIQUE CHECK (length(entry_hash) = 64),
  kind TEXT NOT NULL,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload TEXT NOT NULL,
  CHECK ((seq = 0) = (prev_hash IS NULL))
) STRICT;
${appendOnly("ledger")}`,
  },
  {
    version: 2,
    name: "audit-events",
    sql: `
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  purpose_ref TEXT NOT NULL,
  detail TEXT
) STRICT;
CREATE INDEX audit_events_at ON audit_events (at);
${appendOnly("audit_events")}`,
  },
  {
    version: 3,
    name: "evidence-index",
    sql: `
CREATE TABLE evidence (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  mime TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  fetched_at TEXT NOT NULL,
  transform_id TEXT NOT NULL,
  ledger_seq INTEGER NOT NULL REFERENCES ledger (seq)
) STRICT;
CREATE INDEX evidence_sha256 ON evidence (sha256);
${appendOnly("evidence")}`,
  },
];

export const LATEST_VERSION = MIGRATIONS.reduce((m, x) => Math.max(m, x.version), 0);
export const checksum = (m: Migration) => createHash("sha256").update(`${m.version}\n${m.name}\n${m.sql}`).digest("hex");

export class MigrationError extends Error {
  constructor(
    readonly code: "newer" | "drift" | "gap" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "MigrationError";
  }
}

export const userVersion = (db: DatabaseSync): number =>
  Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);

function assertWellFormed(list: readonly Migration[]): void {
  list.forEach((m, i) => {
    if (m.version !== i + 1) throw new MigrationError("gap", `migration #${i} has version ${m.version}, expected ${i + 1}`);
  });
}

/** Applies pending migrations up to `target` (default: latest). Returns the versions applied. */
export function migrate(db: DatabaseSync, opts: { target?: number; clock?: Clock; migrations?: readonly Migration[] } = {}): number[] {
  const list = opts.migrations ?? MIGRATIONS;
  assertWellFormed(list);
  const latest = list.length;
  const target = opts.target ?? latest;
  const current = userVersion(db);
  if (current > latest) throw new MigrationError("newer", `database is at version ${current}, this build knows up to ${latest}`);
  if (current > 0) {
    const rows = db.prepare("SELECT version, checksum FROM schema_migrations ORDER BY version").all() as {
      version: number;
      checksum: string;
    }[];
    for (const r of rows) {
      const m = list[r.version - 1];
      if (!m || checksum(m) !== r.checksum)
        throw new MigrationError("drift", `migration ${r.version} differs from the one applied to this database`);
    }
    if (rows.length !== current) throw new MigrationError("drift", `user_version ${current} but ${rows.length} migrations recorded`);
  }
  const applied: number[] = [];
  for (const m of list.slice(current, target)) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)").run(
        m.version,
        m.name,
        checksum(m),
        isoNow(opts.clock ?? systemClock),
      );
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec("COMMIT");
    } catch (x) {
      db.exec("ROLLBACK");
      throw new MigrationError("failed", `migration ${m.version} (${m.name}) failed: ${(x as Error).message}`);
    }
    applied.push(m.version);
  }
  return applied;
}
