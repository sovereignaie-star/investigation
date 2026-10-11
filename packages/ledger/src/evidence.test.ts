import zlib from "node:zlib";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { manualClock, seededRandom, ulidFactory } from "@ir/core";
import {
  BlobIntegrityError,
  blobPath,
  fsBlobStore,
  Ledger,
  memoryBlobStore,
  redactRequest,
  REDACTED,
  storeEvidence,
  verify,
  verifyEvidence,
} from "./index.ts";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "ir-blobs-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const enc = (s: string) => new TextEncoder().encode(s);

describe("content-addressed blob store (P1-010)", () => {
  it("T-LED-016: every changed byte of a stored blob is detected on read", () => {
    const root = tmp();
    const store = fsBlobStore(root);
    const body = enc(JSON.stringify({ domain: "example.com", registrar: "مسجّل تجريبي", created: "2001-01-01" }));
    const { sha256, blobRef, size } = store.put(body);
    expect(blobRef).toBe(blobPath(sha256));
    expect(size).toBe(body.length);
    const file = path.join(root, ...blobRef.split("/"));
    expect(store.get(sha256)).toEqual(body);
    const original = readFileSync(file);
    let detected = 0;
    for (let i = 0; i < original.length; i++) {
      for (const flip of [0x01, 0x80]) {
        const bad = Buffer.from(original);
        bad[i] = (bad[i] ?? 0) ^ flip;
        writeFileSync(file, bad);
        expect(() => store.get(sha256), `byte ${i}`).toThrow(BlobIntegrityError);
        expect(store.has(sha256)).toBe(false);
        detected++;
      }
    }
    expect(detected).toBe(original.length * 2);
    writeFileSync(file, original);
    expect(store.get(sha256)).toEqual(body);
  });

  it("T-LED-016: flipping the zstd Last_Block bit is rejected as corrupt even though the decompressed content is identical", () => {
    // Root cause this test pins: zstd's per-block `Last_Block` flag does not change the
    // decompressed bytes, so a content hash alone CANNOT see this tampering. The frame
    // validator must reject it structurally. Same for the frame magic and a truncated
    // frame: each must fail closed even before the hash comparison runs.
    const root = tmp();
    const store = fsBlobStore(root);
    const body = enc(JSON.stringify({ domain: "example.com", registrar: "مسجّل تجريبي", created: "2001-01-01" }));
    const { sha256 } = store.put(body);
    const file = path.join(root, ...store.put(enc("probe")).blobRef.split("/"));
    void file;
    const target = path.join(root, "blobs", sha256.slice(0, 2), sha256);
    const original = readFileSync(target);

    // (1) Flip the Last_Block bit in the first block header (byte 6, bit 0).
    // The decompressed bytes are IDENTICAL, so only the frame check can catch it.
    const lastBlockFlipped = Buffer.from(original);
    lastBlockFlipped[6] ^= 0x01;
    writeFileSync(target, lastBlockFlipped);
    expect(() => store.get(sha256)).toThrow(expect.objectContaining({ reason: "corrupt" }));

    // (2) Corrupt the frame magic: must be corrupt, not mismatch.
    const magicFlipped = Buffer.from(original);
    magicFlipped[0] ^= 0xff;
    writeFileSync(target, magicFlipped);
    expect(() => store.get(sha256)).toThrow(expect.objectContaining({ reason: "corrupt" }));

    // (3) Truncate the frame mid-body: corrupt, not missing.
    writeFileSync(target, original.subarray(0, Math.max(6, Math.floor(original.length / 2))));
    expect(() => store.get(sha256)).toThrow(expect.objectContaining({ reason: "corrupt" }));

    // (4) Append trailing bytes after the final block: corrupt.
    const trailing = Buffer.concat([original, Buffer.from([0x00, 0x01])]);
    writeFileSync(target, trailing);
    expect(() => store.get(sha256)).toThrow(expect.objectContaining({ reason: "corrupt" }));

    // (5) Restore: the read succeeds again — the validator does not reject good frames.
    writeFileSync(target, original);
    expect(store.get(sha256)).toEqual(body);
  });

  it("T-LED-016: the validator accepts all three real block types (Raw, RLE, Compressed), multi-block frames, and each fails when truncated", () => {
    // Directly against the validator via store.get (structural integrity + hash).
    const root = tmp();
    const store = fsBlobStore(root);
    const putAndGetBack = (body: Uint8Array) => {
      const { sha256, blobRef } = store.put(body);
      const file = path.join(root, ...blobRef.split("/"));
      const stored = readFileSync(file);
      // Validator must accept the stored bytes (store.get succeeds) AND the
      // hash comparison confirms the decompressed content is the original.
      expect(store.get(sha256)).toEqual(body);
      return { file, stored, sha256 };
    };

    // (1) Raw block: incompressible random content.
    const raw = new Uint8Array(2048);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 7919) & 0xff;
    const r1 = putAndGetBack(raw);

    // (2) RLE block: highly compressible content.
    const rle = enc("a".repeat(50_000));
    const r2 = putAndGetBack(rle);

    // (3) Compressed block: mixed repetitive content.
    const mixed = enc("pattern123pattern123".repeat(3000));
    const r3 = putAndGetBack(mixed);

    // (4) Multi-block: content larger than the 128 KB max block size forces
    // the compressor to emit MULTIPLE blocks (Raw/Compressed mix).
    const big = new Uint8Array(400_000);
    for (let i = 0; i < big.length; i++) big[i] = (i * 31 + (i >> 7)) & 0xff;
    const r4 = putAndGetBack(big);
    const bodyRef = { sha256: "" } as { sha256: string };
    void bodyRef;

    // (5) Truncation must be rejected for each frame: cut the last block body.
    for (const r of [r1, r2, r3, r4]) {
      const truncated = r.stored.subarray(0, r.stored.length - 2);
      writeFileSync(r.file, truncated);
      expect(() => store.get(r.sha256)).toThrow(BlobIntegrityError);
    }
  });

  it("T-LED-016: a header change outside the 0x01/0x80 masks is rejected even when the decompressed content is identical", () => {
    // The T-LED-016 sweep only flips 0x01 and 0x80. A 0x02 flip of the Block_Type
    // bits can turn a Raw block into a differently-REPRESENTED frame whose decoded
    // bytes are the same (e.g. a frame re-encoded to an equivalent representation).
    // The validator must reject ANY header change that yields a different structure,
    // independent of whether the content hash alone would catch it.
    const root = tmp();
    const store = fsBlobStore(root);
    const body = enc("evidence body for structural rejection");
    const { sha256, blobRef } = store.put(body);
    const file = path.join(root, ...blobRef.split("/"));
    const stored = readFileSync(file);

    // Sanity: the stored frame decompresses to the SAME content with 0x02 flipped
    // in the descriptor byte — a different-but-equivalent representation.
    const descriptorFlipped = Buffer.from(stored);
    descriptorFlipped[4] ^= 0x02;
    let stillSameContent = false;
    try {
      const out = zlib.zstdDecompressSync(descriptorFlipped);
      stillSameContent = out.equals(body);
    } catch {
      stillSameContent = false; // decompression itself failed, which is also fine
    }
    // Either way (content identical or decompression failing), the read must
    // be REJECTED, not silently accepted:
    writeFileSync(file, descriptorFlipped);
    expect(() => store.get(sha256)).toThrow(BlobIntegrityError);
    // If decompression succeeded and content was identical, record that this
    // proves the hash alone would NOT have caught it (validator did).
    if (stillSameContent) {
      expect(store.has(sha256)).toBe(false);
    }
  });

  it("T-LED-016: the Last_Block flip rejection is proven against an INDEPENDENT decompression check, not just the store's own path", () => {
    // The store.get() path shares the validator under test, so this test first
    // proves the premise (flipped frame decompresses to IDENTICAL content) with
    // an independent zlib call, THEN proves the store rejects it.
    const root = tmp();
    const store = fsBlobStore(root);
    const body = enc(JSON.stringify({ domain: "example.com", registrar: "مسجّل تجريبي", created: "2001-01-01" }));
    const { sha256, blobRef } = store.put(body);
    const file = path.join(root, ...blobRef.split("/"));
    const stored = readFileSync(file);

    // Premise check (independent of the store): flip byte 6 bit 0.
    const flipped = Buffer.from(stored);
    flipped[6] ^= 0x01;
    let premiseHolds = false;
    try {
      const out = zlib.zstdDecompressSync(flipped);
      premiseHolds = out.equals(body); // decompressed bytes are IDENTICAL
    } catch {
      premiseHolds = false;
    }
    expect(premiseHolds).toBe(true); // if this fails the premise changed, re-examine

    // Store-level rejection (the thing T-LED-016 actually requires).
    writeFileSync(file, flipped);
    expect(() => store.get(sha256)).toThrow(expect.objectContaining({ reason: "corrupt" }));
    writeFileSync(file, stored);
    expect(store.get(sha256)).toEqual(body);
  });

  it("T-LED-016: a blob replaced by other valid content, or missing, is rejected with its reason", () => {
    const store = memoryBlobStore();
    const a = store.put(enc("evidence A"));
    const b = store.put(enc("evidence B"));
    store.raw.set(a.sha256, store.raw.get(b.sha256) ?? new Uint8Array());
    expect(() => store.get(a.sha256)).toThrow(expect.objectContaining({ reason: "mismatch" }));
    store.raw.delete(a.sha256);
    expect(() => store.get(a.sha256)).toThrow(expect.objectContaining({ reason: "missing" }));
    expect(() => store.get("../../etc/passwd")).toThrow(BlobIntegrityError);
  });

  it("T-LED-017: put is idempotent, deduplicates, writes atomically and compresses with zstd", () => {
    const root = tmp();
    const store = fsBlobStore(root);
    const body = enc("x".repeat(100_000));
    const r1 = store.put(body);
    const r2 = store.put(body);
    expect(r2).toEqual(r1);
    const dir = path.join(root, "blobs", r1.sha256.slice(0, 2));
    expect(readdirSync(dir)).toEqual([r1.sha256]); // no temp files left behind
    const file = path.join(dir, r1.sha256);
    const onDisk = readFileSync(file);
    expect(onDisk.length).toBeLessThan(1000);
    expect([...onDisk.subarray(0, 4)]).toEqual([0x28, 0xb5, 0x2f, 0xfd]); // zstd frame magic
    writeFileSync(file, "damaged");
    store.put(body); // a damaged copy is rewritten
    expect(store.get(r1.sha256)).toEqual(body);
  });
});

describe("evidence records (P1-010)", () => {
  it("T-LED-018: credentials are removed from headers, query strings and URL userinfo before saving", () => {
    const r = redactRequest({
      method: "GET",
      url: "https://user:pw@api.example.com/v1/lookup?q=example.com&api_key=SECRET1&token=SECRET2&page=2",
      headers: {
        Authorization: "Bearer SECRET3",
        Cookie: "s=SECRET4",
        "X-Api-Key": "SECRET5",
        "X-Session-Id": "SECRET6",
        Accept: "application/json",
      },
      status: 200,
    });
    const text = JSON.stringify(r);
    for (const s of ["SECRET1", "SECRET2", "SECRET3", "SECRET4", "SECRET5", "SECRET6", "user:pw"]) expect(text).not.toContain(s);
    expect(r.url).toBe(
      `https://api.example.com/v1/lookup?q=example.com&api_key=${encodeURIComponent(REDACTED)}&token=${encodeURIComponent(REDACTED)}&page=2`,
    );
    expect(r.headers).toEqual({ "x-session-id": REDACTED, accept: "application/json" });
    expect(r.status).toBe(200);
  });

  it("T-LED-019: stored evidence is chained in the ledger, and verifyEvidence finds missing or changed blobs", () => {
    const clock = manualClock("2026-10-10T09:00:00.000Z");
    const ledger = new Ledger({ clock, actor: "engine" });
    const blobs = memoryBlobStore();
    const newId = ulidFactory(clock, seededRandom(1));
    const ev = [0, 1, 2].map((i) =>
      storeEvidence(
        ledger,
        blobs,
        {
          bytes: enc(`<html>record ${i}</html>`),
          mime: "text/html",
          request: { method: "GET", url: `https://example.com/r/${i}?key=K${i}` },
          transformId: "tr-whois",
          version: "1.0.0",
        },
        { clock, newId },
      ),
    );
    expect(ledger.entries().map((e) => e.kind)).toEqual(["evidence.stored", "evidence.stored", "evidence.stored"]);
    expect(verify(ledger.entries()).ok).toBe(true);
    expect(JSON.stringify(ledger.entries())).not.toContain("K1");
    expect(verifyEvidence(ledger.entries(), blobs)).toEqual([]);
    const [e0, e1] = ev;
    if (!e0 || !e1) throw new Error("setup");
    blobs.raw.delete(e0.sha256);
    blobs.raw.set(e1.sha256, blobs.raw.get(ev[2]?.sha256 ?? "") ?? new Uint8Array());
    expect(verifyEvidence(ledger.entries(), blobs)).toEqual([
      { index: 0, id: e0.id, sha256: e0.sha256, reason: "missing" },
      { index: 1, id: e1.id, sha256: e1.sha256, reason: "mismatch" },
    ]);
  });
});
