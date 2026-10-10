import type { DatabaseSync, StatementSync } from "node:sqlite";
import { canonicalize, type Entry, type LedgerStore } from "@ir/ledger";

type Row = { seq: number; prev_hash: string | null; entry_hash: string; kind: string; at: string; actor: string; payload: string };

/** A row edited outside the ledger may not even be JSON; keep it visible so verify() reports entry_hash, not a crash. */
function parsePayload(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { unparseable: text };
  }
}

/**
 * LedgerStore on the `ledger` table. Rows are append-only in the database itself (triggers reject UPDATE and DELETE),
 * and the payload is stored as its JCS text, so reading back gives exactly the bytes that were hashed.
 */
export function sqliteLedgerStore(db: DatabaseSync): LedgerStore {
  const insert: StatementSync = db.prepare(
    "INSERT INTO ledger (seq, prev_hash, entry_hash, kind, at, actor, payload) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const select: StatementSync = db.prepare("SELECT seq, prev_hash, entry_hash, kind, at, actor, payload FROM ledger ORDER BY seq");
  return {
    append(e: Entry) {
      insert.run(e.seq, e.prevHash, e.entryHash, e.kind, e.at, e.actor, canonicalize(e.payload));
    },
    all() {
      return (select.all() as Row[]).map((r) => ({
        seq: r.seq,
        prevHash: r.prev_hash,
        entryHash: r.entry_hash,
        kind: r.kind as Entry["kind"],
        at: r.at,
        actor: r.actor,
        payload: parsePayload(r.payload),
      }));
    },
  };
}
