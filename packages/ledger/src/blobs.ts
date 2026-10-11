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
    detail?: string,
  ) {
    super(detail ? `blob ${sha256}: ${reason} (${detail})` : `blob ${sha256}: ${reason}`);
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

/**
 * Strict structural validation of a zstd frame BEFORE decompression (T-LED-016).
 *
 * Why: zstd's per-block header keeps a `Last_Block` flag, and a single-block frame
 * decompresses to the SAME bytes even when that flag is flipped, so a content hash
 * alone cannot see the tampering. We therefore parse the frame ourselves and reject:
 *  - a wrong magic number,
 *  - a block header that claims `Last_Block` on a block that is not the last one we
 *    can walk to (or vice versa: a mid-stream block marked last),
 *  - a block size larger than the remaining bytes,
 *  - trailing bytes after the final block.
 * This makes any single-byte change to the frame header (including the `Last_Block`
 * bit) a `corrupt` rejection, instead of a silent identical-content success.
 */
/** Parsed zstd frame header: where the first block starts and how long the trailing checksum is. */
type ZstdFrameHeader = { firstBlockOffset: number; checksumLen: number };

/** Validates the 4-byte magic and parses the frame-header descriptor (RFC 8878). */
function parseZstdFrameHeader(buf: Uint8Array): ZstdFrameHeader {
  const MIN = 5; // 4-byte magic + the descriptor byte
  if (buf.length < MIN) throw new Error("frame too short");
  // Magic: 0xFD2FB528 little-endian => bytes 28 B5 2F FD
  if (buf[0] !== 0x28 || buf[1] !== 0xb5 || buf[2] !== 0x2f || buf[3] !== 0xfd) {
    throw new Error("bad magic");
  }
  // Frame_Header_Descriptor (byte 4) per RFC 8878, Table 3 (bit 7 highest):
  //   bits [7:6] Frame_Content_Size_Flag, bit [5] Single_Segment_Flag,
  //   bit [4] (unused), bit [3] (reserved), bit [2] Content_Checksum_Flag,
  //   bits [1:0] Dictionary_ID_Flag.
  const fhd = buf[4];
  const fcsCode = (fhd >> 6) & 0b11;
  const singleSegment = (fhd >> 5) & 1;
  const checksum = (fhd >> 2) & 1;
  // Dictionary_ID_Flag is 2 BITS; DID_Field_Size per RFC 8878 Table 6:
  // 0 => 0 bytes, 1 => 1 byte, 2 => 2 bytes, 3 => 4 bytes.
  const dictIdCode = fhd & 0b11;
  // RFC 8878 Table 4: FCS_Field_Size; flag 0 means "absent" EXCEPT when
  // Single_Segment_Flag is set, in which case it is 1 byte.
  const fcsBytes = fcsCode === 0 ? (singleSegment ? 1 : 0) : fcsCode === 1 ? 2 : fcsCode === 2 ? 4 : 8;
  // RFC 8878: Window_Descriptor (1 byte) is present ONLY when Single_Segment_flag = 0.
  const windowDescriptorBytes = singleSegment ? 0 : 1;
  // The frame header is: magic (4) + descriptor (1) + [Window_Descriptor if !SS] + FCS + [Dictionary_ID].
  const dictIdBytes = dictIdCode === 0 ? 0 : dictIdCode === 1 ? 1 : dictIdCode === 2 ? 2 : 4;
  const headerSize = windowDescriptorBytes + fcsBytes + dictIdBytes;
  return { firstBlockOffset: 5 + headerSize, checksumLen: checksum ? 4 : 0 };
}

/**
 * Reads one 3-byte block header and returns its parts plus the number of stored
 * body bytes that follow it (RLE blocks store exactly one byte).
 */
function readZstdBlockHeader(buf: Uint8Array, offset: number, checksumLen: number): { lastBlock: boolean; storedBytes: number } {
  if (offset + 3 > buf.length) throw new Error("truncated block header");
  const b0 = buf[offset];
  const b1 = buf[offset + 1];
  const b2 = buf[offset + 2];
  const lastBlock = (b0 & 0b0000_0001) !== 0;
  // RFC 8878 Block_Type: 0 = Raw_Block, 1 = RLE_Block, 2 = Compressed_Block, 3 = Reserved.
  const blockType = (b0 >> 1) & 0b11;
  // Block_Size is bits 23:3 (21 bits); b2's bit 7 is the 21st bit. Valid zstd
  // blocks are at most 128 KB (2^17) so that bit is never set in practice, but
  // we read all 21 bits so a tampered value is compared exactly against the body.
  const blockSize = (b0 >> 3) | (b1 << 5) | ((b2 & 0xff) << 13);
  if (blockType === 3 /* Reserved */) throw new Error("reserved block type");
  if (blockType === 1 /* RLE */) {
    // An RLE block is exactly ONE repeated byte; Block_Size is the
    // DECOMPRESSED size it expands to, not the number of stored bytes.
    return { lastBlock, storedBytes: 1 };
  }
  // Raw (0) or Compressed (2): the block body is `blockSize` bytes.
  if (offset + 3 + blockSize + checksumLen > buf.length) throw new Error("truncated block body");
  return { lastBlock, storedBytes: blockSize };
}

function assertZstdFrameIntact(buf: Uint8Array): void {
  const { firstBlockOffset, checksumLen } = parseZstdFrameHeader(buf);
  // Walk every block until one says Last_Block, then require no trailing bytes.
  let offset = firstBlockOffset;
  let guard = 0;
  for (;;) {
    const { lastBlock, storedBytes } = readZstdBlockHeader(buf, offset, checksumLen);
    offset += 3 + storedBytes;
    if (lastBlock) {
      if (offset + checksumLen !== buf.length) {
        throw new Error("trailing bytes after the final block");
      }
      return;
    }
    if (++guard > 1_000_000) throw new Error("too many blocks");
  }
}

/** Shared read path: decompress, re-hash, compare. Any failure is an integrity error, never silent data. */
function verified(sha256: string, compressed: Uint8Array | undefined): Uint8Array {
  if (!compressed) throw new BlobIntegrityError(sha256, "missing");
  // Structural integrity is its own check: a frame that fails the RFC 8878 walk
  // is "corrupt" regardless of whether the library could still decode some bytes.
  // Decompression failure is a SEPARATE corruption: the library refused the frame.
  // Both are "corrupt" but they are distinguished in the message for debugging.
  let structuralError: unknown;
  try {
    assertZstdFrameIntact(compressed);
  } catch (e) {
    structuralError = e;
  }
  let raw: Uint8Array;
  try {
    raw = new Uint8Array(zstd().decompress(compressed));
  } catch (e) {
    throw new BlobIntegrityError(
      sha256,
      "corrupt",
      structuralError ? `frame invalid: ${(structuralError as Error).message}` : `decompression failed: ${(e as Error).message}`,
    );
  }
  if (structuralError) {
    // The frame parsed by the library but failed our stricter structural walk.
    throw new BlobIntegrityError(sha256, "corrupt", `frame invalid: ${(structuralError as Error).message}`);
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
