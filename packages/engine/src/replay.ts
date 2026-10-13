/**
 * P2-018 — offline replay mode (`engine.replay`, T-LED-020).
 *
 * A case's ledger entries carry `evidence.stored` records whose raw responses live in a
 * content-addressed blob store (P1-010). Replaying a case offline means running the same
 * requests against a transport that serves those stored responses instead of the network —
 * deterministic, no sockets, no DNS, no external connections. The resulting projection must
 * match the original projection hash (T-LED-020).
 *
 * `ReplayTransport` implements the engine's `HttpTransport` port: it matches an incoming
 * request to a stored evidence record by method + URL, verifies the blob (content-addressed,
 * so a changed byte is a `BlobIntegrityError`, never a silent wrong response — T-LED-016),
 * and returns the stored bytes. A request with no matching evidence is a hard miss
 * (`transport:network`), never a silent empty response — replay is fail-closed.
 *
 * The engine itself is unchanged: replay is a transport choice. The blob store is the narrow
 * `get(sha256)` port (the ledger's `BlobStore` satisfies it), so the engine stays decoupled
 * from the ledger package.
 */
import { TransportError, type HttpTransport, type TransportRequest, type TransportResponse } from "./transport.ts";

/** The narrow blob-read port a replay transport needs (the ledger's BlobStore satisfies it). */
export interface ReplayBlobStore {
  /** Returns the verified bytes or throws (corrupt/missing/mismatch). */
  get(sha256: string): Uint8Array;
}

/** A stored evidence record, as found in a case's ledger (`evidence.stored` payloads). */
export interface ReplayEvidence {
  readonly request: { readonly method: string; readonly url: string };
  readonly sha256: string;
  readonly mime: string;
}

/** Builds a lookup from evidence records: method+url -> evidence. */
export function indexEvidence(records: readonly ReplayEvidence[]): Map<string, ReplayEvidence> {
  const m = new Map<string, ReplayEvidence>();
  for (const e of records) {
    m.set(`${e.request.method} ${e.request.url}`, e);
  }
  return m;
}

/**
 * A transport that serves stored evidence instead of the network. Fail-closed:
 *   - a request with no matching evidence is a `transport:network` error (never a silent empty response);
 *   - a blob that fails content-address verification is a `BlobIntegrityError` (T-LED-016), never a wrong response.
 */
export class ReplayTransport implements HttpTransport {
  private readonly index: Map<string, ReplayEvidence>;
  served = 0;
  missed = 0;
  constructor(
    records: readonly ReplayEvidence[],
    private readonly blobs: ReplayBlobStore,
  ) {
    this.index = indexEvidence(records);
  }

  async fetch(req: TransportRequest, _signal: AbortSignal): Promise<TransportResponse> {
    const key = `${req.method} ${req.url}`;
    const ev = this.index.get(key);
    if (ev === undefined) {
      this.missed++;
      throw new TransportError("transport:network", `replay: no stored evidence for ${req.method} ${req.url}`);
    }
    const bytes = this.blobs.get(ev.sha256); // throws on corrupt/missing/mismatch
    this.served++;
    return {
      status: 200,
      body: bytes,
      contentType: ev.mime,
    };
  }
}

/** The result of an offline replay. */
export interface ReplayResult {
  readonly runId: string;
  readonly phase: string;
  readonly transportAttempts: number;
  readonly served: number;
  readonly missed: number;
}

/**
 * Runs a single input against a replay transport and reports how many requests were served
 * from stored evidence vs missed. The caller compares the replayed projection hash to the
 * original case's projection hash (T-LED-020).
 */
export async function replayCase(opts: {
  readonly records: readonly ReplayEvidence[];
  readonly blobs: ReplayBlobStore;
  readonly input: { readonly kind: string; readonly canonicalInput: string };
  readonly caps: { maxNodes: number; maxDepth: number; maxRequests: number; maxCostEstimate: number; maxElapsedMs: number };
}): Promise<ReplayResult> {
  const transport = new ReplayTransport(opts.records, opts.blobs);
  const { RunEngine } = await import("./run.ts");
  const engine = new RunEngine({ transport, caps: opts.caps });
  const handle = engine.submit(opts.input);
  const results = await engine.drain();
  const res = results.find((r) => r.runId === handle.runId);
  return {
    runId: handle.runId,
    phase: res?.phase ?? "unknown",
    transportAttempts: res?.transportAttempts ?? 0,
    served: transport.served,
    missed: transport.missed,
  };
}
