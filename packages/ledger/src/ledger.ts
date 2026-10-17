import { createHash } from "node:crypto";
import { isoNow, systemClock, type Clock } from "@ir/core";
import { LedgerEntry, LedgerKind } from "@ir/schema";
import { canonicalize } from "./jcs.ts";
import { verify } from "./verify.ts";

/** Domain-separation tag; bump with a new ADR if the hashed fields ever change. */
export const LEDGER_FORMAT = "ir-ledger/1";

export type Entry = LedgerEntry;
export type Kind = (typeof LedgerKind.options)[number];

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * entryHash = SHA-256(UTF-8(JCS([LEDGER_FORMAT, prevHash, seq, kind, at, actor, payload]))) (ADR-06).
 * Every stored field except entryHash itself is covered, so changing any byte of an entry is detected (T-LED-001..004).
 */
export function hashEntry(e: Omit<Entry, "entryHash">): string {
  return sha256Hex(canonicalize([LEDGER_FORMAT, e.prevHash, e.seq, e.kind, e.at, e.actor, e.payload]));
}

function freeze<T>(v: T): T {
  if (v && typeof v === "object") {
    for (const x of Object.values(v)) freeze(x);
    Object.freeze(v);
  }
  return v;
}

/** Where entries live. Implementations must be append-only (P1-013 adds SQLite); there is no update or delete. */
export interface LedgerStore {
  append(entry: Entry): void;
  all(): readonly Entry[];
}

export function memoryStore(initial: readonly Entry[] = []): LedgerStore {
  const rows: Entry[] = [...initial];
  return { append: (e) => void rows.push(e), all: () => rows.slice() };
}

export interface LedgerOptions {
  store?: LedgerStore;
  clock?: Clock;
  actor: string;
  /** Skip the open-time chain check (only for verifiers that report problems instead of refusing). */
  skipVerify?: boolean;
}

/** Append-only hash chain (5.5, D1). */
export class Ledger {
  readonly #store: LedgerStore;
  readonly #clock: Clock;
  readonly #actor: string;

  constructor(opts: LedgerOptions) {
    this.#store = opts.store ?? memoryStore();
    this.#clock = opts.clock ?? systemClock;
    this.#actor = opts.actor;
    const existing = this.#store.all();
    if (existing.length > 0 && !opts.skipVerify) {
      const report = verify(existing);
      if (!report.ok) throw new Error(`ledger store is corrupt: ${report.errors[0]?.message ?? "unknown"}`);
    }
  }

  /** The ledger's operating actor (the identity case operations are recorded under). P2-026
   *  (owner decision 2026-10-17 — item 3): the central PurposeConfirmation wiring reads it as the
   *  confirmer of the case's purpose — the engine's natural-person gate requires a confirmer, not
   *  just a purpose. */
  get actor(): string {
    return this.#actor;
  }

  /** Appends one entry; the payload is canonicalized now, so later mutation of the caller's object cannot change it. */
  append(kind: Kind, payload: unknown, actor: string = this.#actor): Entry {
    const all = this.#store.all();
    const last = all[all.length - 1];
    const body = {
      seq: last ? last.seq + 1 : 0,
      prevHash: last ? last.entryHash : null,
      kind,
      payload: JSON.parse(canonicalize(payload)) as unknown,
      at: isoNow(this.#clock),
      actor,
    };
    const entry = freeze(LedgerEntry.parse({ ...body, entryHash: hashEntry(body) }));
    this.#store.append(entry);
    return entry;
  }

  entries(): readonly Entry[] {
    return this.#store.all();
  }

  get length(): number {
    return this.#store.all().length;
  }

  /** Hash of the newest entry; publish or sign it (P1-011) to detect truncation of the tail later. */
  head(): string | null {
    const all = this.#store.all();
    return all[all.length - 1]?.entryHash ?? null;
  }
}
