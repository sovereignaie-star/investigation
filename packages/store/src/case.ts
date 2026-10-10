import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { systemClock, ulidFactory, isoNow, type Clock } from "@ir/core";
import { fsBlobStore, Ledger, storeEvidence, type BlobStore, type Entry, type Kind, type StoreEvidenceInput } from "@ir/ledger";
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
): { key: CaseKey | null; encrypted: boolean; caseId: string | null } {
  const keyFile = path.join(dir, CASE_KEY);
  const keyText = readIfExists(keyFile);
  if (keyText !== undefined) {
    const file = JSON.parse(keyText) as CaseKeyFile;
    const caseId = (db.prepare("SELECT value FROM meta WHERE key = 'case_id'").get() as { value: string } | undefined)?.value;
    if (caseId !== undefined && caseId !== file.caseId) throw new Error(`${CASE_KEY} belongs to case ${file.caseId}, not ${caseId}`);
    return { key: opts.passphrase === undefined ? null : unlockCaseKey(file, opts.passphrase), encrypted: true, caseId: null };
  }
  const isNew = (db.prepare("SELECT count(*) n FROM meta").get() as { n: number }).n === 0;
  if (!isNew && opts.passphrase !== undefined) throw new Error("this case is not encrypted; open it without a passphrase");
  if (!isNew || opts.readOnly) return { key: null, encrypted: false, caseId: null };
  if (!opts.create) throw new NoCaseError(dir);
  const caseId = ulidFactory(clock)();
  const insert = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
  let key: CaseKey | null = null;
  if (opts.passphrase !== undefined) {
    const created = createCaseKey(caseId, opts.passphrase, opts.kdf);
    writeFileSync(keyFile, `${JSON.stringify(created.file, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    key = created.key;
  }
  insert.run("case_id", caseId);
  insert.run("created_at", isoNow(clock));
  insert.run("encryption", key ? "aes-256-gcm+argon2id" : "none");
  return { key, encrypted: key !== null, caseId };
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

export function openCase(dir: string, opts: OpenCaseOptions): Case {
  const clock = opts.clock ?? systemClock;
  const db = openDb(dir, opts.readOnly ?? false, clock);
  try {
    // Validate the purpose before anything is written, so a rejected case leaves no files behind.
    const init = opts.create && !opts.readOnly ? CaseInit.parse(opts.create) : undefined;
    const { key, encrypted, caseId: createdId } = resolveKey(dir, db, opts, clock);
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
    const transaction = <T>(fn: () => T): T => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const r = fn();
        db.exec("COMMIT");
        return r;
      } catch (x) {
        db.exec("ROLLBACK");
        throw x;
      }
    };
    const sealed = (kind: Kind) => encrypted && kind !== "checkpoint";
    const append = (kind: Kind, payload: unknown): Entry => {
      if (!sealed(kind)) return ledger.append(kind, payload);
      if (!key) throw new CaseLockedError();
      return ledger.append(kind, key.sealPayload(kind, payload));
    };
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
    if (createdId && init) {
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
        append("case.created", record);
        self.audit("case.created", record.id, { legalBasis: record.legalBasis });
      });
    } else if (key && !opts.readOnly) {
      self.audit("case.unlocked", caseIdOf());
    }
    return self;
  } catch (x) {
    db.close();
    throw x;
  }
}
