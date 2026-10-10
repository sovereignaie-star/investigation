import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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
    expect(statSync(file).size).toBeLessThan(1000);
    expect([...readFileSync(file).subarray(0, 4)]).toEqual([0x28, 0xb5, 0x2f, 0xfd]); // zstd frame magic
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
