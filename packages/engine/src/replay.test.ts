import { describe, expect, it } from "vitest";
import { ReplayTransport, indexEvidence, replayCase, type ReplayEvidence } from "./replay.ts";
import { TransportError } from "./transport.ts";

const caps = {
  maxNodes: 5,
  maxDepth: 3,
  maxRequests: 5,
  maxCostEstimate: 100,
  maxElapsedMs: 5_000,
};

/** In-memory blob store: content-addressed, verifies on read (mirrors the ledger's BlobStore). */
function memBlobs(entries: Record<string, Uint8Array>) {
  return {
    get(sha256: string): Uint8Array {
      const b = entries[sha256];
      if (b === undefined) throw new Error(`blob ${sha256}: missing`);
      return b;
    },
  };
}

describe("ReplayTransport (P2-018)", () => {
  const records: ReplayEvidence[] = [
    { request: { method: "GET", url: "https://example.com/a" }, sha256: "blob-a", mime: "application/json" },
    { request: { method: "GET", url: "https://example.com/b" }, sha256: "blob-b", mime: "text/plain" },
  ];
  const blobs = memBlobs({
    "blob-a": new TextEncoder().encode('{"a":1}'),
    "blob-b": new TextEncoder().encode("hello"),
  });

  it("serves a stored response for a matching request (offline, no network)", async () => {
    const t = new ReplayTransport(records, blobs);
    const res = await t.fetch({ method: "GET", url: "https://example.com/a" }, new AbortController().signal);
    expect(res.status).toBe(200);
    expect(res.contentType).toBe("application/json");
    expect(new TextDecoder().decode(res.body as Uint8Array)).toBe('{"a":1}');
    expect(t.served).toBe(1);
    expect(t.missed).toBe(0);
  });

  it("fails closed on a request with no stored evidence (never a silent empty response)", async () => {
    const t = new ReplayTransport(records, blobs);
    await expect(t.fetch({ method: "GET", url: "https://example.com/unknown" }, new AbortController().signal)).rejects.toThrow(
      TransportError,
    );
    expect(t.missed).toBe(1);
    expect(t.served).toBe(0);
  });

  it("fails closed on a corrupt/missing blob (T-LED-016: never a wrong response)", async () => {
    const t = new ReplayTransport(records, memBlobs({}));
    await expect(t.fetch({ method: "GET", url: "https://example.com/a" }, new AbortController().signal)).rejects.toThrow(/missing/);
    expect(t.served).toBe(0);
  });

  it("indexes evidence by method+url", () => {
    const idx = indexEvidence(records);
    expect(idx.get("GET https://example.com/a")?.sha256).toBe("blob-a");
    expect(idx.get("GET https://example.com/b")?.sha256).toBe("blob-b");
    expect(idx.get("POST https://example.com/a")).toBeUndefined();
  });
});

describe("replayCase (P2-018, T-LED-020)", () => {
  it("replays a run offline against stored evidence and reports served/missed", async () => {
    const records: ReplayEvidence[] = [
      { request: { method: "GET", url: "https://example.com/a" }, sha256: "blob-a", mime: "application/json" },
    ];
    const blobs = memBlobs({ "blob-a": new TextEncoder().encode('{"a":1}') });
    const res = await replayCase({
      records,
      blobs,
      input: { kind: "lookup", canonicalInput: "https://example.com/a" },
      caps,
    });
    expect(res.served).toBe(1);
    expect(res.missed).toBe(0);
    expect(res.transportAttempts).toBe(1);
    expect(res.phase).toBe("succeeded");
  });

  it("P2-014: every replay attempt is served from stored evidence or a hard miss — never an external connection", async () => {
    const records: ReplayEvidence[] = [
      { request: { method: "GET", url: "https://example.com/a" }, sha256: "blob-a", mime: "application/json" },
      { request: { method: "GET", url: "https://example.com/b" }, sha256: "blob-b", mime: "application/json" },
    ];
    const blobs = memBlobs({
      "blob-a": new TextEncoder().encode('{"a":1}'),
      "blob-b": new TextEncoder().encode('{"b":1}'),
    });
    // one run issues one request (the engine builds url: canonicalInput), so the accounting property
    // is checked on both sides: a served outcome and a hard miss.
    const served = await replayCase({
      records,
      blobs,
      input: { kind: "lookup", canonicalInput: "https://example.com/a" },
      caps,
    });
    const missed = await replayCase({
      records,
      blobs,
      input: { kind: "lookup", canonicalInput: "https://example.com/c" }, // no stored evidence for c
      caps,
    });
    // every attempt is accounted for: served from the blob store, or a hard miss (fail-closed).
    // A replayed attempt can never be an unaccounted external connection — the transport has no
    // network path by construction, and this equality is the check that no third kind exists.
    expect(served.transportAttempts).toBe(served.served + served.missed);
    expect(served.served).toBe(1);
    expect(served.missed).toBe(0);
    expect(missed.transportAttempts).toBe(missed.served + missed.missed);
    expect(missed.served).toBe(0);
    expect(missed.missed).toBe(1); // a hard miss, never a network call
  });

  it("reports a miss when the replayed run needs a request with no stored evidence", async () => {
    const res = await replayCase({
      records: [],
      blobs: memBlobs({}),
      input: { kind: "lookup", canonicalInput: "https://example.com/a" },
      caps,
    });
    expect(res.missed).toBe(1);
    expect(res.served).toBe(0);
  });
});
