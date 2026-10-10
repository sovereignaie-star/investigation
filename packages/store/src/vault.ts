import { argon2Sync, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isoNow, systemClock, type Clock } from "@ir/core";
import { DEFAULT_KDF, type KdfCost } from "./crypto.ts";

/**
 * Server-side key vault (P1-015, D-030). Provider API keys live only on the server, in one file sealed entry by entry
 * with AES-256-GCM (AAD = vault format + entry name, so entries cannot be swapped). The master key comes from
 * IR_VAULT_KEY (32 bytes, base64/base64url), from IR_VAULT_PASSPHRASE via Argon2id, or, for a local install with
 * neither, from a generated key file (0600) beside the vault. The vault API never returns a secret to callers outside
 * the server: list() yields names and timestamps; reveal() is for server-side connectors only.
 */
export const VAULT_FORMAT = "ir-vault/1";
const NAME = /^[a-z][a-z0-9_-]{1,39}$/;

type Sealed = { iv: string; ct: string; tag: string; updatedAt: string };
type VaultFile = {
  format: typeof VAULT_FORMAT;
  kdf?: { alg: "argon2id"; salt: string; memoryKiB: number; passes: number; parallelism: number };
  check: Sealed;
  entries: Record<string, Sealed>;
};

export interface VaultEntryInfo {
  name: string;
  updatedAt: string;
}
export interface Vault {
  list(): VaultEntryInfo[];
  has(name: string): boolean;
  set(name: string, secret: string): VaultEntryInfo;
  delete(name: string): boolean;
  /** Server-side use only (connectors). Never send the result to a client or a log. */
  reveal(name: string): string | undefined;
}

export type VaultMaster = { key: Uint8Array } | { passphrase: string; kdf?: Partial<KdfCost> } | { keyFile: string };

export class VaultLockedError extends Error {
  constructor() {
    super("vault master key does not match this vault");
    this.name = "VaultLockedError";
  }
}

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url");

export function assertVaultName(name: string): void {
  if (!NAME.test(name)) throw new Error(`invalid vault entry name: ${JSON.stringify(name).slice(0, 50)}`);
}

/** Parses IR_VAULT_KEY: exactly 32 bytes in base64 or base64url. */
export function parseMasterKey(text: string): Uint8Array {
  const k = Buffer.from(text.trim(), "base64");
  if (k.length !== 32) throw new Error("IR_VAULT_KEY must be 32 bytes in base64 (e.g. `openssl rand -base64 32`)");
  return k;
}

function loadOrCreateKeyFile(file: string): Uint8Array {
  try {
    return parseMasterKey(readFileSync(file, "utf8"));
  } catch (x) {
    if ((x as NodeJS.ErrnoException).code !== "ENOENT") throw x;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  const key = randomBytes(32);
  writeFileSync(file, `${key.toString("base64")}\n`, { flag: "wx", mode: 0o600 });
  return key;
}

function readVaultFile(file: string): VaultFile | undefined {
  try {
    const v = JSON.parse(readFileSync(file, "utf8")) as VaultFile;
    if (v.format !== VAULT_FORMAT) throw new Error(`unsupported vault format in ${file}`);
    return v;
  } catch (x) {
    if ((x as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw x;
  }
}

export function openVault(file: string, master: VaultMaster, opts: { clock?: Clock } = {}): Vault {
  const clock = opts.clock ?? systemClock;
  const existing = readVaultFile(file);
  let kdf = existing?.kdf;
  let key: Uint8Array;
  if ("key" in master) {
    if (master.key.length !== 32) throw new Error("vault key must be 32 bytes");
    key = master.key;
  } else if ("keyFile" in master) {
    key = loadOrCreateKeyFile(master.keyFile);
  } else {
    kdf ??= { alg: "argon2id", salt: b64(randomBytes(16)), ...DEFAULT_KDF, ...master.kdf };
    key = argon2Sync("argon2id", {
      message: Buffer.from(master.passphrase.normalize("NFC"), "utf8"),
      nonce: unb64(kdf.salt),
      memory: kdf.memoryKiB,
      passes: kdf.passes,
      parallelism: kdf.parallelism,
      tagLength: 32,
    });
  }
  const seal = (name: string, value: string): Sealed => {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", key, iv);
    c.setAAD(Buffer.from(`${VAULT_FORMAT}|${name}`));
    const ct = Buffer.concat([c.update(value, "utf8"), c.final()]);
    return { iv: b64(iv), ct: b64(ct), tag: b64(c.getAuthTag()), updatedAt: isoNow(clock) };
  };
  const open = (name: string, s: Sealed): string => {
    const d = createDecipheriv("aes-256-gcm", key, unb64(s.iv));
    d.setAAD(Buffer.from(`${VAULT_FORMAT}|${name}`));
    d.setAuthTag(unb64(s.tag));
    return Buffer.concat([d.update(unb64(s.ct)), d.final()]).toString("utf8");
  };
  const state: VaultFile = existing ?? { format: VAULT_FORMAT, ...(kdf ? { kdf } : {}), check: seal("\0check", "ok"), entries: {} };
  try {
    if (open("\0check", state.check) !== "ok") throw new VaultLockedError();
  } catch {
    throw new VaultLockedError();
  }
  const save = () => {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(tmp, file);
  };
  if (!existing) save();
  const has = (name: string) => Object.hasOwn(state.entries, name);
  return {
    list: () =>
      Object.entries(state.entries)
        .map(([name, s]) => ({ name, updatedAt: s.updatedAt }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    has,
    set(name, secret) {
      assertVaultName(name);
      const value = secret.trim();
      if (value.length === 0 || value.length > 4096) throw new Error("secret must be 1..4096 characters");
      state.entries[name] = seal(name, value);
      save();
      return { name, updatedAt: state.entries[name].updatedAt };
    },
    delete(name) {
      if (!has(name)) return false;
      // Rebuild without the entry instead of `delete` on a dynamic key.
      state.entries = Object.fromEntries(Object.entries(state.entries).filter(([n]) => n !== name));
      save();
      return true;
    },
    reveal: (name) => (has(name) ? open(name, state.entries[name] as Sealed) : undefined),
  };
}

/** Vault from the environment: IR_VAULT_KEY, else IR_VAULT_PASSPHRASE, else <dataDir>/vault.key (generated). */
export function vaultFromEnv(env: NodeJS.ProcessEnv, dataDir: string): Vault {
  const file = path.join(dataDir, "vault.json");
  if (env["IR_VAULT_KEY"]) return openVault(file, { key: parseMasterKey(env["IR_VAULT_KEY"]) });
  if (env["IR_VAULT_PASSPHRASE"]) return openVault(file, { passphrase: env["IR_VAULT_PASSPHRASE"] });
  return openVault(file, { keyFile: path.join(dataDir, "vault.key") });
}
