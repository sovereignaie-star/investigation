import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { systemClock, ulidFactory, isoNow, type Clock } from "@ir/core";
import {
  canonicalize,
  fsBlobStore,
  Ledger,
  storeEvidence,
  type BlobStore,
  type Entry,
  type Kind,
  type StoreEvidenceInput,
} from "@ir/ledger";
import { Projector, view, type Projection } from "@ir/ledger/projections";
import { AuditEvent, Case as CaseRecord, CaseInit } from "@ir/schema";
import type { Evidence } from "@ir/schema";
import {
  changePassphrase,
  createCaseKey,
  encryptedBlobStore,
  isEnvelope,
  unlockCaseKey,
  type CaseKey,
  type CaseKeyFile,
  type KdfCost,
} from "./crypto.ts";
import { migrate } from "./migrations.ts";
import { sqliteLedgerStore } from "./sqlite-ledger.ts";

/**
 * One case = one directory: `case.sqlite` (meta, ledger, audit, evidence index), `blobs/` (raw evidence) and, for
 * encrypted cases, `case.key.json` (the passphrase-wrapped data key). Portable, easy to back up, verifiable offline
 * (5.5, ADR-04). Encrypted cases seal every ledger payload except signed checkpoints, and every blob (P1-014).
 */
export interface Case {
  readonly dir: string;
  readonly db: DatabaseSync;
  /** The raw chain (sealed payloads in encrypted cases). Use it for verification and checkpoints. */
  readonly ledger: Ledger;
  readonly blobs: BlobStore;
  readonly encrypted: boolean;
  /** Encrypted and opened without the passphrase: the chain can be verified, but content cannot be read. */
  readonly locked: boolean;
  /** Appends an entry; in encrypted cases the payload is sealed first. */
  append(kind: Kind, payload: unknown): Entry;
  /**
   * P4-005 (UC-11): optimistic-concurrency append — appends ONLY if the ledger's
   * head seq still equals `expectedSeq`, ALL inside one SQLite IMMEDIATE
   * transaction (the read of the head, the check and the write are atomic wrt
   * every other writer). Returns the entry, or null when the head moved — the
   * caller's pre-append validation is then outdated and must be rejected
   * WITHOUT any partial write. This is the primitive the merge/revert routes
   * use so a stale suggestion can never append on top of a changed case.
   */
  appendIfSeq(kind: Kind, payload: unknown, expectedSeq: number): Entry | null;
  /** Entries with readable payloads (throws if the case is locked or a sealed payload fails authentication). */
  entries(): Entry[];
  /** Like entries(), but reports payloads that fail to open instead of throwing (verification). */
  openEntries(): { entries: Entry[]; unopenable: number[] };
  addEvidence(input: StoreEvidenceInput, opts?: { newId?: () => string }): Evidence;
  /** The case record (purpose, legal basis, retention...) after all `case.updated` entries (P1-018). */
  info(): CaseRecord;
  /** Changes purpose, basis, retention, sensitivity, title or tags; the reason is kept in the chain (P1-018). */
  update(changes: Partial<Omit<CaseRecord, "id" | "createdAt" | "ownerId">>, reason: string): CaseRecord;
  /** Records a sensitive action in the chain and the audit index (P1-017, E-10). */
  audit(action: string, target: string, detail?: Record<string, unknown>): AuditEvent;
  /** All audit events, oldest first (from the chain, so they are covered by verification and checkpoints). */
  auditTrail(): AuditEvent[];
  /** Re-wraps the case key under a new passphrase (encrypted cases) and audits it. */
  changePassphrase(oldPassphrase: string, newPassphrase: string): void;
  /**
   * Graph, table and coverage views (P1-016). Built from the chain on first use, then kept live on every append;
   * always equal to a rebuild from the stored chain (projectionHash). Throws if the case is locked.
   */
  projection(): Projection;
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
  /** Unlocks an encrypted case; for a new case, creates it encrypted. */
  passphrase?: string;
  /** Argon2id cost for a new encrypted case (defaults: RFC 9106 second recommendation). */
  kdf?: Partial<KdfCost>;
  /** Required to create a case: no case without a stated purpose and legal basis (P1-018, E-01). */
  create?: CaseInit;
}

export const CASE_DB = "case.sqlite";
export const CASE_KEY = "case.key.json";

export class NoCaseError extends Error {
  constructor(dir: string) {
    super(`E-01: no case in ${dir}; creating one requires a stated purpose and legal basis (OpenCaseOptions.create)`);
    this.name = "NoCaseError";
  }
}

/**
 * A writable open found a case directory whose chain does not start with `case.created` (D-052): an interrupted
 * creation from builds before P1-028, or a database written outside @ir/store. Such a case has no stated purpose
 * and is never used for new work (E-01); `ir verify` reports it.
 */
export class IncompleteCaseError extends Error {
  constructor(dir: string) {
    super(`E-01: ${dir} has no case.created entry (no stated purpose); it cannot be opened for writing`);
    this.name = "IncompleteCaseError";
  }
}

/** The chain of a complete case starts with its purpose record (P1-018, D-052). */
export const startsWithPurpose = (entries: readonly Entry[]): boolean => entries[0]?.kind === "case.created";

export class CaseLockedError extends Error {
  constructor() {
    super("case is encrypted: a passphrase is required to read or write its content");
    this.name = "CaseLockedError";
  }
}

/** Single open, no existence check first (avoids a check-then-read race). */
function readIfExists(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch (x) {
    if ((x as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw x;
  }
}

function resolveKey(
  dir: string,
  db: DatabaseSync,
  opts: OpenCaseOptions,
  clock: Clock,
): { key: CaseKey | null; encrypted: boolean; caseId: string | null; meta: [string, string][]; keyFileCreated: boolean } {
  const keyFile = path.join(dir, CASE_KEY);
  const keyText = readIfExists(keyFile);
  const none = { caseId: null, meta: [], keyFileCreated: false };
  if (keyText !== undefined) {
    const file = JSON.parse(keyText) as CaseKeyFile;
    const caseId = (db.prepare("SELECT value FROM meta WHERE key = 'case_id'").get() as { value: string } | undefined)?.value;
    if (caseId !== undefined && caseId !== file.caseId) throw new Error(`${CASE_KEY} belongs to case ${file.caseId}, not ${caseId}`);
    return { key: opts.passphrase === undefined ? null : unlockCaseKey(file, opts.passphrase), encrypted: true, ...none };
  }
  const isNew = (db.prepare("SELECT count(*) n FROM meta").get() as { n: number }).n === 0;
  if (!isNew && opts.passphrase !== undefined) throw new Error("this case is not encrypted; open it without a passphrase");
  if (!isNew || opts.readOnly) return { key: null, encrypted: false, ...none };
  if (!opts.create) throw new NoCaseError(dir);
  const caseId = ulidFactory(clock)();
  const createdAt = isoNow(clock);
  let key: CaseKey | null = null;
  if (opts.passphrase !== undefined) {
    const created = createCaseKey(caseId, opts.passphrase, opts.kdf);
    // last step here: anything that fails after this point removes the file again (openCase)
    writeFileSync(keyFile, `${JSON.stringify(created.file, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    key = created.key;
  }
  // D-052: the meta rows are written by openCase in the same transaction as case.created, never on their own
  const meta: [string, string][] = [
    ["case_id", caseId],
    ["created_at", createdAt],
    ["encryption", key ? "aes-256-gcm+argon2id" : "none"],
  ];
  return { key, encrypted: key !== null, caseId, meta, keyFileCreated: key !== null };
}

/** Opens case.sqlite; writable opens use WAL, full fsync and the latest migrations. */
function openDb(dir: string, readOnly: boolean, clock: Clock): DatabaseSync {
  if (!readOnly) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, CASE_DB), { readOnly, enableForeignKeyConstraints: true, timeout: 5000 });
  if (readOnly) return db;
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = FULL");
    migrate(db, { clock });
    return db;
  } catch (x) {
    db.close();
    throw x;
  }
}

/** Cleanup after a failed open: a new encrypted case that did not finish must not leave a key file (D-052). */
function abandon(db: DatabaseSync, dir: string, createdKeyFile: boolean): void {
  if (db.isOpen) db.close();
  if (createdKeyFile) rmSync(path.join(dir, CASE_KEY), { force: true });
}

/**
 * P3-003 (J-17): what a listing may reveal about a case WITHOUT opening its content —
 * a locked case shows an identifier and status only. Reads the plain meta and audit
 * index directly (no chain verification, no payload decryption).
 */
export interface CaseFingerprint {
  caseId: string;
  createdAt: string;
  encrypted: boolean;
  /** Last audit-event timestamp from the plain index; null when the case has no events yet. */
  lastActivityAt: string | null;
}

/**
 * P3-003: reads a case directory's identifier and timestamps without opening case content.
 * Returns null when the directory holds no complete case (e.g. an abandoned staging dir).
 * The J-17 primitive: for a locked case the caller must not attempt to read more than this.
 */
export function caseFingerprint(dir: string): CaseFingerprint | null {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path.join(dir, CASE_DB), { readOnly: true });
  } catch {
    return null; // no complete case in this directory
  }
  try {
    const meta = db.prepare("SELECT value FROM meta WHERE key = ?");
    const caseId = (meta.get("case_id") as { value: string } | undefined)?.value;
    if (!caseId) return null;
    const createdAt = (meta.get("created_at") as { value: string } | undefined)?.value ?? "";
    const encrypted = (meta.get("encryption") as { value: string } | undefined)?.value !== "none";
    const last = db.prepare("SELECT MAX(at) AS last FROM audit_events").get() as { last: string | null } | undefined;
    return { caseId, createdAt, encrypted, lastActivityAt: last?.last ?? null };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export function openCase(dir: string, opts: OpenCaseOptions): Case {
  const clock = opts.clock ?? systemClock;
  const db = openDb(dir, opts.readOnly ?? false, clock);
  let createdKeyFile = false;
  try {
    // Validate the purpose before anything is written, so a rejected case leaves no files behind.
    const init = opts.create && !opts.readOnly ? CaseInit.parse(opts.create) : undefined;
    const { key, encrypted, caseId: createdId, meta: newMeta, keyFileCreated } = resolveKey(dir, db, opts, clock);
    createdKeyFile = keyFileCreated;
    const locked = encrypted && key === null;
    const ledger = new Ledger({ store: sqliteLedgerStore(db), clock, actor: opts.actor, skipVerify: opts.skipChainCheck ?? false });
    const plainBlobs = fsBlobStore(dir);
    const lockedBlobs: BlobStore = {
      put: () => {
        throw new CaseLockedError();
      },
      get: () => {
        throw new CaseLockedError();
      },
      has: () => false,
    };
    const blobs: BlobStore = !encrypted ? plainBlobs : key ? encryptedBlobStore(dir, key) : lockedBlobs;
    const insertEvidence = db.prepare(
      "INSERT INTO evidence (id, sha256, mime, size, fetched_at, transform_id, ledger_seq) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const getMeta = db.prepare("SELECT value FROM meta WHERE key = ?");
    let projector: Projector | null = null;
    const transaction = <T>(fn: () => T): T => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const r = fn();
        db.exec("COMMIT");
        return r;
      } catch (x) {
        db.exec("ROLLBACK");
        projector = null; // entries applied inside the rolled-back transaction are gone: rebuild on next use
        throw x;
      }
    };
    const sealed = (kind: Kind) => encrypted && kind !== "checkpoint";
    const rawAppend = (kind: Kind, payload: unknown): Entry => {
      if (!sealed(kind)) return ledger.append(kind, payload);
      if (!key) throw new CaseLockedError();
      return ledger.append(kind, key.sealPayload(kind, payload));
    };
    const append = (kind: Kind, payload: unknown): Entry => {
      const entry = rawAppend(kind, payload);
      // the live projection sees exactly what a reader of the chain will see: the JCS form of the plain payload
      projector?.apply({ ...entry, payload: JSON.parse(canonicalize(payload)) as unknown });
      return entry;
    };
    // P4-005: check-the-head and append in ONE atomic write scope (see the interface doc).
    const appendIfSeq = (kind: Kind, payload: unknown, expectedSeq: number): Entry | null =>
      transaction(() => {
        const all = ledger.entries();
        const lastSeq = all[all.length - 1]?.seq ?? -1;
        if (lastSeq !== expectedSeq) return null; // stale: the head moved since the caller's validation
        return append(kind, payload);
      });
    const insertAudit = db.prepare(
      "INSERT INTO audit_events (id, at, actor, action, target, purpose_ref, detail) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const newId = ulidFactory(clock);
    const caseIdOf = (): string => (getMeta.get("case_id") as { value: string } | undefined)?.value ?? "";
    const self: Case = {
      dir,
      db,
      ledger,
      blobs,
      encrypted,
      locked,
      append,
      appendIfSeq,
      entries() {
        if (!encrypted) return [...ledger.entries()];
        if (!key) throw new CaseLockedError();
        return ledger.entries().map((e) => (isEnvelope(e.payload) ? { ...e, payload: key.openPayload(e.kind, e.payload) } : e));
      },
      openEntries() {
        if (!encrypted) return { entries: [...ledger.entries()], unopenable: [] };
        if (!key) throw new CaseLockedError();
        const unopenable: number[] = [];
        const entries = ledger.entries().map((e, i) => {
          if (!isEnvelope(e.payload)) return e;
          try {
            return { ...e, payload: key.openPayload(e.kind, e.payload) };
          } catch {
            unopenable.push(i);
            return e;
          }
        });
        return { entries, unopenable };
      },
      addEvidence(input, o = {}) {
        db.exec("BEGIN IMMEDIATE");
        try {
          const ev = storeEvidence({ append }, blobs, input, { clock, ...(o.newId ? { newId: o.newId } : {}) });
          // encrypted cases index the keyed blob address, not the content hash
          insertEvidence.run(
            ev.id,
            key ? key.blobAddress(ev.sha256) : ev.sha256,
            ev.mime,
            ev.size,
            ev.fetchedAt,
            ev.transformId,
            ledger.length - 1,
          );
          self.audit("evidence.stored", ev.id, { transformId: ev.transformId, size: ev.size });
          db.exec("COMMIT");
          return ev;
        } catch (x) {
          db.exec("ROLLBACK");
          throw x;
        }
      },
      projection() {
        if (locked) throw new CaseLockedError();
        projector ??= new Projector().applyAll(self.entries());
        return view(projector);
      },
      meta: (k) => (getMeta.get(k) as { value: string } | undefined)?.value ?? null,
      info() {
        const all = self.entries();
        const created = all.find((e) => e.kind === "case.created");
        if (!created) throw new Error("case has no case.created entry");
        let rec = CaseRecord.parse(created.payload);
        for (const e of all)
          if (e.kind === "case.updated") rec = CaseRecord.parse({ ...rec, ...(e.payload as { changes: object }).changes });
        return rec;
      },
      update(changes, reason) {
        if (reason.trim().length < 3) throw new Error("a reason is required to change the case record");
        const { id: _i, createdAt: _c, ownerId: _o, ...allowed } = changes as Partial<CaseRecord>;
        const next = CaseRecord.parse({ ...self.info(), ...allowed });
        transaction(() => {
          append("case.updated", { changes: allowed, reason });
          self.audit("case.updated", next.id, { fields: Object.keys(allowed), reason });
        });
        return next;
      },
      audit(action, target, detail) {
        const ev = AuditEvent.parse({
          id: newId(),
          at: isoNow(clock),
          actor: opts.actor,
          action,
          target,
          purposeRef: caseIdOf(),
          ...(detail ? { detail } : {}),
        });
        // chain entry and index row together; joins the caller's transaction when there is one
        const write = () => {
          append("audit.event", ev);
          // the index keeps detail only for unencrypted cases; encrypted ones keep it sealed in the chain
          insertAudit.run(
            ev.id,
            ev.at,
            ev.actor,
            ev.action,
            ev.target,
            ev.purposeRef,
            detail && !encrypted ? JSON.stringify(detail) : null,
          );
        };
        if (db.isTransaction) write();
        else transaction(write);
        return ev;
      },
      auditTrail: () => self.entries().flatMap((e) => (e.kind === "audit.event" ? [AuditEvent.parse(e.payload)] : [])),
      changePassphrase(oldPassphrase, newPassphrase) {
        if (!encrypted) throw new Error("this case is not encrypted");
        const keyFile = path.join(dir, CASE_KEY);
        const next = changePassphrase(JSON.parse(readFileSync(keyFile, "utf8")) as CaseKeyFile, oldPassphrase, newPassphrase, opts.kdf);
        const tmp = `${keyFile}.next`;
        writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
        renameSync(tmp, keyFile);
        self.audit("case.passphrase_changed", caseIdOf());
      },
      close: () => db.close(),
    };
    // P1-018/D-052: a new case gets its identity and purpose in one transaction; an existing one must have a purpose
    const settle = (): void => {
      if (createdId && init) {
        // D-052: identity (meta), purpose (case.created) and its audit event commit together or not at all
        const insertMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
        const record = CaseRecord.parse({
          retention: { mode: "indefinite", reason: "not set" },
          sensitivity: "standard",
          tags: [],
          ownerId: opts.actor,
          ...init,
          id: createdId,
          createdAt: isoNow(clock),
        });
        transaction(() => {
          for (const [k, v] of newMeta) insertMeta.run(k, v);
          append("case.created", record);
          self.audit("case.created", record.id, { legalBasis: record.legalBasis });
        });
      } else if (!opts.readOnly && !startsWithPurpose(ledger.entries())) {
        throw new IncompleteCaseError(dir);
      } else if (key && !opts.readOnly) {
        self.audit("case.unlocked", caseIdOf());
      }
    };
    settle();
    return self;
  } catch (x) {
    abandon(db, dir, createdKeyFile);
    throw x;
  }
}
