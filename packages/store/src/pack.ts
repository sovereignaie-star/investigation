/**
 * P4-016 — the signed `.irpack` case package (T-IO-006 التوقيع والتجزئات, NFR-18).
 *
 * A `.irpack` is a single deterministic ZIP (STORE-only, fixed timestamps) holding the case's
 * source of truth — the raw hash chain (sealed payloads preserved verbatim for encrypted
 * cases), the evidence blob tree, the wrapped case key and a convenience copy of the case
 * record — plus a signed manifest: every file's SHA-256, the chain's length/head/Merkle root,
 * and an Ed25519 signature (the same installation-key infrastructure as checkpoints, P1-011)
 * over the JCS form of the manifest. The SQLite database is NOT in the pack: it is a
 * projection of the chain, so the importer rebuilds it at its own schema version (NFR-18 —
 * a pack opens on any install whose build knows the pack's schema, and a pack from a newer
 * build is refused, not half-opened).
 *
 * Fail-closed everywhere: a wrong hash, a wrong signature, an unexpected file, a non-empty
 * target directory or a failed post-restore verification each abort the import leaving
 * nothing behind.
 */
import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { crc32 } from "node:zlib";
import { isoNow, systemClock, type Clock } from "@ir/core";
import { canonicalize, keyIdOf, merkleRoot, verify as verifyChain, type Entry, type InstallationKey } from "@ir/ledger";
import { AuditEvent, Evidence, LedgerEntry } from "@ir/schema";
import { LATEST_VERSION, migrate } from "./migrations.ts";
import { sqliteLedgerStore } from "./sqlite-ledger.ts";
import { openCase } from "./case.ts";
import { verifyCase, type CaseReport } from "./verify-case.ts";
import { CASE_KEY, startsWithPurpose } from "./case.ts";
import { isEnvelope, unlockCaseKey, type CaseKeyFile } from "./crypto.ts";

export const IRPACK_FORMAT = "irpack/1";

/** Fail-closed pack/unpack errors (never a silent skip). */
export class PackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackError";
  }
}

export interface PackOptions {
  actor: string;
  clock?: Clock;
  /** The installation key that signs the manifest (Ed25519, P1-011 infrastructure). */
  key: InstallationKey;
  /** Unlocks an encrypted case for export; a locked case is refused, never packed half-read. */
  passphrase?: string;
  /** Provenance of the exporting build; the repo's own version when omitted. */
  appVersion?: string;
}

export interface UnpackOptions {
  /** Pin the signer: refuse packs signed by any other installation key. */
  expectedKeyId?: string;
  /** Pin the signer by public key: refuse packs signed by any other installation key. */
  expectedPublicKeyPem?: string;
  /** Required for encrypted packs (the indexes are rebuilt from the opened payloads). */
  passphrase?: string;
  clock?: Clock;
}

export interface IrpackManifest {
  format: string;
  appVersion: string;
  exportedAt: string;
  schemaVersion: number;
  case: { id: string; encrypted: boolean; title: string; purpose: string; legalBasis: string };
  chain: { length: number; head: string; merkleRoot: string };
  files: { name: string; sha256: string; size: number }[];
  keyId: string;
  publicKeyPem: string;
  signature: string;
}

export interface UnpackResult {
  caseId: string;
  head: string;
  length: number;
  report: CaseReport;
}

const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

// --- minimal deterministic ZIP (STORE-only; we control both ends, and the format stays
// --- readable by standard tools — no compression means no non-deterministic encoders)
const DOS_TIME = 0;
const DOS_DATE = 0x21; // 1980-01-01: fixed, so identical inputs pack to identical bytes
const enc = new TextEncoder();

function zipWrite(entries: readonly { name: string; data: Uint8Array }[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(Buffer.from(e.data)) >>> 0;
    const local = new Uint8Array(30 + name.length + e.data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, e.data.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(e.data, 30 + name.length);
    locals.push(local);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true); // STORE
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const total = offset + cdSize + eocd.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function zipRead(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const findEocd = (): number => {
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) return i;
    }
    throw new PackError("not an .irpack: no ZIP end-of-central-directory");
  };
  const eocd = findEocd();
  const count = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  const files = new Map<string, Uint8Array>();
  let at = cdOffset;
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new PackError("not an .irpack: corrupt central directory");
    const method = view.getUint16(at + 10, true);
    const csize = view.getUint32(at + 20, true);
    const usize = view.getUint32(at + 24, true);
    const nlen = view.getUint16(at + 28, true);
    const elen = view.getUint16(at + 30, true);
    const clen = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nlen));
    if (method !== 0 || csize !== usize) throw new PackError(`packed file ${name}: only STORE is supported`);
    if (view.getUint32(offset, true) !== 0x04034b50) throw new PackError(`packed file ${name}: corrupt local header`);
    const lnlen = view.getUint16(offset + 26, true);
    const lelen = view.getUint16(offset + 28, true);
    const start = offset + 30 + lnlen + lelen;
    files.set(name, bytes.subarray(start, start + csize));
    at += 46 + nlen + elen + clen;
  }
  return files;
}

// --- the pack's files
const MANIFEST = "manifest.json";
const CHAIN = "chain.ndjson";
const CASE_JSON = "case.json";
const KEY = "key.json";

/** Parse a pack without verifying it (tests and inspection rebuild packs from parts). */
export function parseIrpack(bytes: Uint8Array): { manifest: IrpackManifest; files: Map<string, Uint8Array> } {
  const all = zipRead(bytes);
  const manifestText = all.get(MANIFEST);
  if (!manifestText) throw new PackError(`not an .irpack: no ${MANIFEST}`);
  const manifest = JSON.parse(new TextDecoder().decode(manifestText)) as IrpackManifest;
  const files = new Map(all);
  files.delete(MANIFEST);
  return { manifest, files };
}

/** Rebuild a pack from parts (the manifest is signed by the caller — tests use this for surgery). */
export function buildIrpack(files: Map<string, Uint8Array>, manifest: IrpackManifest): Uint8Array {
  const names = [...files.keys()].sort();
  const manifestEntry = {
    name: MANIFEST,
    data: enc.encode(`${JSON.stringify(manifest, null, 2)}\n`),
  };
  const entries = [manifestEntry, ...names.map((name) => ({ name, data: files.get(name) ?? new Uint8Array() }))];
  return zipWrite(entries);
}

// --- export
const listBlobFiles = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.relative(dir, path.join(d.parentPath, d.name)))
    .filter((n) => n.startsWith(`blobs${path.sep}`))
    .map((n) => n.split(path.sep).join("/"));

export function packCase(dir: string, opts: PackOptions): Uint8Array {
  const clock = opts.clock ?? systemClock;
  let c;
  try {
    c = openCase(dir, { actor: opts.actor, readOnly: true, ...(opts.passphrase ? { passphrase: opts.passphrase } : {}) });
  } catch (x) {
    throw new PackError(`cannot open ${dir}: ${(x as Error).message}`);
  }
  try {
    if (c.locked) throw new PackError("the case is locked: a passphrase is required to pack it");
    const entries = c.ledger.entries();
    if (!startsWithPurpose(entries)) throw new PackError("the chain has no case.created: refusing to pack an incomplete case");
    const info = c.info();
    const chainText = `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`;
    const caseText = `${JSON.stringify(info, null, 2)}\n`;
    const files = new Map<string, Uint8Array>([
      [CHAIN, enc.encode(chainText)],
      [CASE_JSON, enc.encode(caseText)],
    ]);
    if (c.encrypted) files.set(KEY, new Uint8Array(readFileSync(path.join(dir, CASE_KEY))));
    for (const name of listBlobFiles(dir)) files.set(name, new Uint8Array(readFileSync(path.join(dir, name))));
    const listed = [...files.keys()].sort().map((name) => {
      const data = files.get(name) ?? new Uint8Array();
      return { name, sha256: sha256(data), size: data.length };
    });
    const unsigned: Omit<IrpackManifest, "signature"> = {
      format: IRPACK_FORMAT,
      appVersion: opts.appVersion ?? "0.0.0",
      exportedAt: isoNow(clock),
      schemaVersion: LATEST_VERSION,
      case: {
        id: info.id,
        encrypted: c.encrypted,
        title: info.title,
        purpose: info.purpose,
        legalBasis: info.legalBasis,
      },
      chain: {
        length: entries.length,
        head: entries[entries.length - 1]?.entryHash ?? "",
        merkleRoot: merkleRoot(entries.map((e) => e.entryHash)),
      },
      files: listed,
      keyId: opts.key.keyId,
      publicKeyPem: opts.key.publicKeyPem,
    };
    const signature = opts.key.sign(enc.encode(canonicalize(unsigned)));
    return buildIrpack(files, { ...unsigned, signature });
  } finally {
    c.close();
  }
}

// --- import
const checkManifest = (m: IrpackManifest, opts: UnpackOptions): void => {
  if (m.format !== IRPACK_FORMAT) throw new PackError(`unsupported pack format: ${m.format} (this build reads ${IRPACK_FORMAT})`);
  if (m.schemaVersion > LATEST_VERSION)
    throw new PackError(`pack was built by a newer schema (v${m.schemaVersion} > v${LATEST_VERSION}): upgrade to open it`);
  const pub = createPublicKey(m.publicKeyPem);
  if (pub.asymmetricKeyType !== "ed25519") throw new PackError("pack signer is not Ed25519");
  const { signature, ...unsigned } = m;
  const ok = cryptoVerify(null, enc.encode(canonicalize(unsigned)), pub, Buffer.from(signature, "base64url"));
  if (!ok) throw new PackError("manifest signature verification failed");
  if (keyIdOf(m.publicKeyPem) !== m.keyId) throw new PackError("pack keyId does not match its public key");
  if (opts.expectedKeyId !== undefined && opts.expectedKeyId !== m.keyId)
    throw new PackError(`pack is signed by ${m.keyId}, expected ${opts.expectedKeyId}`);
  if (opts.expectedPublicKeyPem !== undefined && opts.expectedPublicKeyPem.trim() !== m.publicKeyPem.trim())
    throw new PackError("pack is signed by a different installation key than the pinned --key");
};

const checkFiles = (m: IrpackManifest, files: Map<string, Uint8Array>): void => {
  const listed = new Set(m.files.map((f) => f.name));
  for (const name of files.keys()) {
    if (!listed.has(name)) throw new PackError(`unexpected file in pack: ${name} is not in the manifest`);
  }
  for (const f of m.files) {
    const data = files.get(f.name);
    if (!data) throw new PackError(`manifest lists ${f.name} but the pack does not contain it`);
    const digest = sha256(data);
    if (digest !== f.sha256) throw new PackError(`hash mismatch for ${f.name}: manifest says ${f.sha256}, file hashes to ${digest}`);
    if (data.length !== f.size) throw new PackError(`size mismatch for ${f.name}: manifest says ${f.size}, file is ${data.length}`);
  }
};

const parseChain = (data: Uint8Array): Entry[] => {
  const text = new TextDecoder().decode(data).trim();
  if (!text) throw new PackError("empty chain.ndjson");
  return text.split("\n").map((line, i) => {
    const parsed = LedgerEntry.safeParse(JSON.parse(line));
    if (!parsed.success) throw new PackError(`chain.ndjson line ${i + 1} is not a valid ledger entry`);
    return parsed.data as Entry;
  });
};

const checkChain = (m: IrpackManifest, entries: readonly Entry[]): void => {
  if (!startsWithPurpose(entries)) throw new PackError("the packed chain has no case.created: incomplete case");
  const report = verifyChain(entries);
  if (!report.ok) throw new PackError(`packed chain fails verification: ${report.errors[0]?.message ?? "unknown"}`);
  const head = entries[entries.length - 1]?.entryHash ?? "";
  if (entries.length !== m.chain.length)
    throw new PackError(`chain length mismatch: manifest says ${m.chain.length}, chain has ${entries.length}`);
  if (head !== m.chain.head) throw new PackError(`chain head mismatch: manifest says ${m.chain.head}, chain heads to ${head}`);
  const root = merkleRoot(entries.map((e) => e.entryHash));
  if (root !== m.chain.merkleRoot)
    throw new PackError(`chain Merkle root mismatch: manifest says ${m.chain.merkleRoot}, chain roots to ${root}`);
};

/** Opens sealed payloads with the pack's own key file (encrypted packs need the passphrase). */
function payloadOpener(keyFile: CaseKeyFile | null, passphrase: string | undefined): (kind: string, payload: unknown) => unknown {
  if (!keyFile) return (_kind, payload) => payload;
  if (passphrase === undefined) throw new PackError("encrypted pack: a passphrase is required to rebuild the case indexes");
  const key = unlockCaseKey(keyFile, passphrase);
  return (kind, payload) => (isEnvelope(payload) ? key.openPayload(kind, payload) : payload);
}

/** Rebuilds the database (the chain's projection) and the evidence/audit mirrors. */
function restoreDb(dir: string, entries: readonly Entry[], keyFile: CaseKeyFile | null, opts: UnpackOptions): void {
  const db = new DatabaseSync(path.join(dir, "case.sqlite"), { enableForeignKeyConstraints: true, timeout: 5000 });
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = FULL");
    migrate(db, { clock: opts.clock ?? systemClock });
    const store = sqliteLedgerStore(db);
    for (const e of entries) store.append(e);
    const record = JSON.parse(new TextDecoder().decode(readFileSync(path.join(dir, "case.json")))) as {
      id: string;
      createdAt: string;
    };
    const insertMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
    insertMeta.run("case_id", record.id);
    insertMeta.run("created_at", record.createdAt);
    insertMeta.run("encryption", keyFile ? "aes-256-gcm+argon2id" : "none");
    rebuildMirrors(db, entries, keyFile, opts);
  } finally {
    db.close();
  }
}

function rebuildMirrors(db: DatabaseSync, entries: readonly Entry[], keyFile: CaseKeyFile | null, opts: UnpackOptions): void {
  const open = payloadOpener(keyFile, opts.passphrase);
  const insertEvidence = db.prepare(
    "INSERT INTO evidence (id, sha256, mime, size, fetched_at, transform_id, ledger_seq) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const insertAudit = db.prepare(
    "INSERT INTO audit_events (id, at, actor, action, target, purpose_ref, detail) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  for (const e of entries) {
    const payload = open(e.kind, e.payload);
    if (e.kind === "evidence.stored") {
      const ev = Evidence.safeParse(payload);
      if (!ev.success) throw new PackError(`entry ${e.seq}: evidence.stored payload is not a valid Evidence record`);
      insertEvidence.run(
        ev.data.id,
        keyFile ? blobAddressOf(keyFile, opts, ev.data.sha256) : ev.data.sha256,
        ev.data.mime,
        ev.data.size,
        ev.data.fetchedAt,
        ev.data.transformId,
        e.seq,
      );
    } else if (e.kind === "audit.event") {
      const ev = AuditEvent.safeParse(payload);
      if (!ev.success) throw new PackError(`entry ${e.seq}: audit.event payload is not a valid AuditEvent`);
      const detail = ev.data.detail && !keyFile ? JSON.stringify(ev.data.detail) : null;
      insertAudit.run(ev.data.id, ev.data.at, ev.data.actor, ev.data.action, ev.data.target, ev.data.purposeRef, detail);
    }
  }
}

const blobAddressOf = (keyFile: CaseKeyFile, opts: UnpackOptions, sha: string): string =>
  unlockCaseKey(keyFile, opts.passphrase ?? "").blobAddress(sha);

/** Everything unpackCase needs from a verified pack, gathered and checked before any write. */
function validatedPack(
  bytes: Uint8Array,
  opts: UnpackOptions,
): {
  manifest: IrpackManifest;
  files: Map<string, Uint8Array>;
  entries: Entry[];
  caseJson: Uint8Array;
  keyFile: CaseKeyFile | null;
} {
  const { manifest, files } = parseIrpack(bytes);
  checkManifest(manifest, opts);
  checkFiles(manifest, files);
  const chainData = files.get(CHAIN);
  if (!chainData) throw new PackError(`pack has no ${CHAIN}`);
  const entries = parseChain(chainData);
  checkChain(manifest, entries);
  const caseJson = files.get(CASE_JSON);
  if (!caseJson) throw new PackError(`pack has no ${CASE_JSON}`);
  const keyData = files.get(KEY);
  if (manifest.case.encrypted && !keyData) throw new PackError("pack says the case is encrypted but carries no key file");
  const keyFile = keyData ? (JSON.parse(new TextDecoder().decode(keyData)) as CaseKeyFile) : null;
  return { manifest, files, entries, caseJson, keyFile };
}

export function unpackCase(bytes: Uint8Array, dir: string, opts: UnpackOptions = {}): UnpackResult {
  const { manifest, files, entries, caseJson, keyFile } = validatedPack(bytes, opts);
  const keyData = files.get(KEY);
  const created = !existsDir(dir);
  if (!created && readdirSync(dir).length > 0) throw new PackError(`refusing to unpack into ${dir}: the directory is not empty`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "case.json"), caseJson);
    if (keyData) writeFileSync(path.join(dir, CASE_KEY), keyData, { mode: 0o600 });
    for (const [name, data] of files) {
      if (!name.startsWith("blobs/")) continue;
      const target = path.join(dir, ...name.split("/"));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, data);
    }
    restoreDb(dir, entries, keyFile, opts);
    // checkpoint signatures are NOT checked against the pack signer here: a transferred case
    // keeps its own checkpoints (possibly signed by another installation); `ir verify --key`
    // judges them, and the pack's own signature was already verified above.
    const report = verifyCase(dir, { ...(opts.passphrase ? { passphrase: opts.passphrase } : {}) });
    if (!report.ok) {
      const problems = [
        ...report.chain.errors.map((e) => e.message),
        ...report.audit.problems,
        ...report.evidence.problems.map((p) => String(p)),
      ].join("; ");
      throw new PackError(`the restored case failed verification: ${problems}`);
    }
    return { caseId: manifest.case.id, head: manifest.chain.head, length: manifest.chain.length, report };
  } catch (x) {
    // fail-closed: leave nothing behind (a directory that existed stays, emptied of our writes)
    for (const name of ["case.json", "case.sqlite", "case.sqlite-wal", "case.sqlite-shm", ...(keyData ? [CASE_KEY] : [])])
      rmSync(path.join(dir, name), { force: true });
    rmSync(path.join(dir, "blobs"), { recursive: true, force: true });
    if (created) rmSync(dir, { force: true });
    throw x;
  }
}

function existsDir(p: string): boolean {
  try {
    readdirSync(p);
    return true;
  } catch {
    return false;
  }
}
