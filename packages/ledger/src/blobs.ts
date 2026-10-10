import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as zlib from "node:zlib";

/**
 * Content-addressed evidence store (5.5, P1-010): raw bytes live at blobs/<sha256[0:2]>/<sha256>, zstd-compressed.
 * The address is the SHA-256 of the uncompressed bytes, and every read recomputes it, so a changed byte on disk can
 * never be returned as evidence (T-LED-016).
 */
export type BlobRef = { sha256: string; size: number; blobRef: string };

export class BlobIntegrityError extends Error {
  constructor(
    readonly sha256: string,
    readonly reason: "missing" | "corrupt" | "mismatch",
  ) {
    super(`blob ${sha256}: ${reason}`);
    this.name = "BlobIntegrityError";
  }
}

export interface BlobStore {
  put(bytes: Uint8Array): BlobRef;
  /** Returns the verified bytes or throws BlobIntegrityError. */
  get(sha256: string): Uint8Array;
  has(sha256: string): boolean;
}

const SHA = /^[0-9a-f]{64}$/;
export const blobPath = (sha256: string) => `blobs/${sha256.slice(0, 2)}/${sha256}`;
const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

type Zstd = { compress: (b: Uint8Array) => Uint8Array; decompress: (b: Uint8Array) => Uint8Array };
function zstd(): Zstd {
  const z = zlib as unknown as { zstdCompressSync?: (b: Uint8Array) => Buffer; zstdDecompressSync?: (b: Uint8Array) => Buffer };
  if (!z.zstdCompressSync || !z.zstdDecompressSync) throw new Error("zstd needs Node >= 22.15 (the project targets Node 24)");
  return { compress: z.zstdCompressSync, decompress: z.zstdDecompressSync };
}

/** Shared read path: decompress, re-hash, compare. Any failure is an integrity error, never silent data. */
function verified(sha256: string, compressed: Uint8Array | undefined): Uint8Array {
  if (!compressed) throw new BlobIntegrityError(sha256, "missing");
  let raw: Uint8Array;
  try {
    raw = new Uint8Array(zstd().decompress(compressed));
  } catch {
    throw new BlobIntegrityError(sha256, "corrupt");
  }
  if (sha256Hex(raw) !== sha256) throw new BlobIntegrityError(sha256, "mismatch");
  return raw;
}

function ref(bytes: Uint8Array): BlobRef {
  const sha256 = sha256Hex(bytes);
  return { sha256, size: bytes.length, blobRef: blobPath(sha256) };
}

/** Files under `<root>/blobs/`. Writes are atomic (temp file + rename) and idempotent; a damaged copy is replaced. */
export function fsBlobStore(root: string): BlobStore {
  const file = (sha: string) => path.join(root, ...blobPath(sha).split("/"));
  const read = (sha: string): Uint8Array | undefined => {
    try {
      return new Uint8Array(readFileSync(file(sha)));
    } catch (x) {
      if ((x as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw x;
    }
  };
  const store: BlobStore = {
    put(bytes) {
      const r = ref(bytes);
      if (store.has(r.sha256)) return r;
      const target = file(r.sha256);
      mkdirSync(path.dirname(target), { recursive: true });
      const tmp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
      writeFileSync(tmp, zstd().compress(bytes), { flag: "wx" });
      renameSync(tmp, target);
      return r;
    },
    get(sha256) {
      if (!SHA.test(sha256)) throw new BlobIntegrityError(sha256, "missing");
      return verified(sha256, read(sha256));
    },
    has(sha256) {
      if (!SHA.test(sha256)) return false;
      try {
        verified(sha256, read(sha256));
        return true;
      } catch {
        return false;
      }
    },
  };
  return store;
}

/** In-memory store with the same compressed, verified read path (tests and ephemeral cases). */
export function memoryBlobStore(): BlobStore & { raw: Map<string, Uint8Array> } {
  const raw = new Map<string, Uint8Array>();
  return {
    raw,
    put(bytes) {
      const r = ref(bytes);
      if (!this.has(r.sha256)) raw.set(r.sha256, new Uint8Array(zstd().compress(bytes)));
      return r;
    },
    get: (sha256) => verified(sha256, raw.get(sha256)),
    has(sha256) {
      try {
        verified(sha256, raw.get(sha256));
        return true;
      } catch {
        return false;
      }
    },
  };
}
