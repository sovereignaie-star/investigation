import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { systemClock, type Clock } from "@ir/core";
import { fsBlobStore, Ledger, storeEvidence, type BlobStore, type StoreEvidenceInput } from "@ir/ledger";
import type { Evidence } from "@ir/schema";
import { migrate } from "./migrations.ts";
import { sqliteLedgerStore } from "./sqlite-ledger.ts";

/**
 * One case = one directory: `case.sqlite` (meta, ledger, audit, evidence index) and `blobs/` (raw evidence). Portable,
 * easy to back up, and verifiable offline (5.5, ADR-04).
 */
export interface Case {
  readonly dir: string;
  readonly db: DatabaseSync;
  readonly ledger: Ledger;
  readonly blobs: BlobStore;
  addEvidence(input: StoreEvidenceInput, opts?: { newId?: () => string }): Evidence;
  meta(key: string): string | null;
  close(): void;
}

export interface OpenCaseOptions {
  actor: string;
  clock?: Clock;
  /** Open read-only (verification, export): no migrations, no writes. */
  readOnly?: boolean;
  /** Verifiers report chain errors themselves instead of refusing to open (used by verifyCase). */
  skipChainCheck?: boolean;
}

export const CASE_DB = "case.sqlite";

export function openCase(dir: string, opts: OpenCaseOptions): Case {
  const clock = opts.clock ?? systemClock;
  if (!opts.readOnly) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, CASE_DB), {
    readOnly: opts.readOnly ?? false,
    enableForeignKeyConstraints: true,
    timeout: 5000,
  });
  try {
    if (!opts.readOnly) {
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA synchronous = FULL");
      migrate(db, { clock });
    }
    const ledger = new Ledger({ store: sqliteLedgerStore(db), clock, actor: opts.actor, skipVerify: opts.skipChainCheck ?? false });
    const blobs = fsBlobStore(dir);
    const insertEvidence = db.prepare(
      "INSERT INTO evidence (id, sha256, mime, size, fetched_at, transform_id, ledger_seq) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const getMeta = db.prepare("SELECT value FROM meta WHERE key = ?");
    return {
      dir,
      db,
      ledger,
      blobs,
      addEvidence(input, o = {}) {
        db.exec("BEGIN IMMEDIATE");
        try {
          const ev = storeEvidence(ledger, blobs, input, { clock, ...(o.newId ? { newId: o.newId } : {}) });
          insertEvidence.run(ev.id, ev.sha256, ev.mime, ev.size, ev.fetchedAt, ev.transformId, ledger.length - 1);
          db.exec("COMMIT");
          return ev;
        } catch (x) {
          db.exec("ROLLBACK");
          throw x;
        }
      },
      meta: (key) => (getMeta.get(key) as { value: string } | undefined)?.value ?? null,
      close: () => db.close(),
    };
  } catch (x) {
    db.close();
    throw x;
  }
}
