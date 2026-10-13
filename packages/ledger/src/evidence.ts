import { ulidFactory, isoNow, systemClock, type Clock } from "@ir/core";
import { Evidence, REDACTED_HEADERS } from "@ir/schema";
import { BlobIntegrityError, type BlobStore } from "./blobs.ts";
import type { Entry, Kind } from "./ledger.ts";

/** Anything that appends to the chain: a Ledger, or a case that seals payloads before appending (P1-014). */
export type Appender = { append(kind: Kind, payload: unknown): unknown };

/** Query parameters and header names that carry credentials; their values never reach the ledger (5.5 privacy). */
const SECRET_PARAM =
  /^(?:key|api[-_]?key|apikey|token|access[-_]?token|auth|sig|signature|password|passwd|secret|client[-_]?secret|session)$/i;
const SECRET_HEADER = /(?:token|secret|api[-_]?key|signature|session)/i;
export const REDACTED = "[REDACTED]";

export type RawRequest = { method: Evidence["request"]["method"]; url: string; headers?: Record<string, string>; status?: number };

/** Drops credential headers and replaces credential query values and URL userinfo with a marker. */
export function redactRequest(req: RawRequest): Evidence["request"] {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    const lower = k.toLowerCase();
    if ((REDACTED_HEADERS as readonly string[]).includes(lower)) continue;
    headers[lower] = SECRET_HEADER.test(lower) ? REDACTED : v;
  }
  let url = req.url;
  // D-017 / P2-006: no silent catch. A URL that fails to parse is not an error — it is a
  // non-absolute reference (DNS name, local path) and is stored as given. The branch is explicit.
  const parsed = tryParseUrl(req.url);
  if (parsed !== null) {
    const u = parsed;
    if (u.username || u.password) {
      u.username = "";
      u.password = "";
    }
    for (const name of [...u.searchParams.keys()]) if (SECRET_PARAM.test(name)) u.searchParams.set(name, REDACTED);
    url = u.toString();
  }
  return { method: req.method, url, headers, ...(req.status !== undefined ? { status: req.status } : {}) };
}

/** Parses a URL, or null when it is not an absolute URL (DNS name, local path). */
function tryParseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export interface StoreEvidenceInput {
  bytes: Uint8Array;
  mime: string;
  request: RawRequest;
  transformId: string;
  version: string;
  fetchedAt?: string;
}

/**
 * Saves the raw response as a blob and appends an `evidence.stored` entry with its address (D1, fixes the "no raw
 * response, no source" half of D-036). Returns the Evidence record that observations should cite.
 */
export function storeEvidence(
  ledger: Appender,
  blobs: BlobStore,
  input: StoreEvidenceInput,
  opts: { clock?: Clock; newId?: () => string } = {},
): Evidence {
  const clock = opts.clock ?? systemClock;
  const ref = blobs.put(input.bytes);
  const evidence = Evidence.parse({
    id: (opts.newId ?? ulidFactory(clock))(),
    sha256: ref.sha256,
    mime: input.mime,
    size: ref.size,
    blobRef: ref.blobRef,
    fetchedAt: input.fetchedAt ?? isoNow(clock),
    request: redactRequest(input.request),
    transformId: input.transformId,
    version: input.version,
  });
  ledger.append("evidence.stored", evidence);
  return evidence;
}

export type EvidenceProblem = { index: number; id: string; sha256: string; reason: "missing" | "corrupt" | "mismatch" | "size" | "schema" };

/** Re-reads every blob referenced by `evidence.stored` entries; each read re-hashes the bytes (T-LED-019). */
export function verifyEvidence(entries: readonly Entry[], blobs: BlobStore): EvidenceProblem[] {
  const problems: EvidenceProblem[] = [];
  entries.forEach((e, index) => {
    if (e.kind !== "evidence.stored") return;
    const parsed = Evidence.safeParse(e.payload);
    if (!parsed.success) {
      problems.push({ index, id: "?", sha256: "?", reason: "schema" });
      return;
    }
    const ev = parsed.data;
    try {
      const bytes = blobs.get(ev.sha256);
      if (bytes.length !== ev.size) problems.push({ index, id: ev.id, sha256: ev.sha256, reason: "size" });
    } catch (x) {
      if (!(x instanceof BlobIntegrityError)) throw x;
      problems.push({ index, id: ev.id, sha256: ev.sha256, reason: x.reason });
    }
  });
  return problems;
}
