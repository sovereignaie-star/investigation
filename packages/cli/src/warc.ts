/**
 * P3-020 / UC-06 — the WARC container serialization of a TR-012 run, the post-step the
 * transform's own header documents («تسلسل WARC خطوة معالجة لاحقة خارج المحوّل»): the transform
 * never writes files (SDK contract), so the CLI serializes the WARC/1.0 container of the
 * archived response and stores it as case evidence — beside the raw response, with its own
 * sha256 and the same archive moment (WARC-Date = the raw evidence's fetchedAt).
 *
 * Honesty notes (documented, not hidden):
 * - WARC-Payload-Digest is the sha256 of the exact archived body — the same hash the case
 *   already holds for the raw evidence, so the container is verifiable against the ledger.
 * - The embedded HTTP block is rebuilt from the evidence record (status, content type, body):
 *   the raw wire headers are NOT retained by the evidence store (D-036 redaction), so the
 *   block carries the recorded status and content type only — the payload is byte-exact.
 */
import { createHash, randomUUID } from "node:crypto";
import type { Case } from "@ir/store";
import type { StoredRequest } from "./run-record.ts";

/** One evidence.stored payload of the ledger (the fields the WARC step needs). */
interface EvidenceRecord {
  id: string;
  sha256: string;
  mime: string;
  fetchedAt: string;
}

/** The WARC/1.0 records of one archived response: a warcinfo record and the response record. */
export function warcArchiveBytes(input: {
  target: string;
  fetchedAt: string;
  status: number;
  contentType: string;
  body: Uint8Array;
}): Uint8Array {
  const bodyHash = createHash("sha256").update(input.body).digest("hex");
  const encoder = new TextEncoder();
  const httpBlock = encoder.encode(`HTTP/1.1 ${input.status} OK\r\nContent-Type: ${input.contentType}\r\n\r\n`);
  const responseContent = new Uint8Array(httpBlock.length + input.body.length);
  responseContent.set(httpBlock, 0);
  responseContent.set(input.body, httpBlock.length);
  const warcinfo = encoder.encode(
    [
      "WARC/1.0",
      "WARC-Type: warcinfo",
      `WARC-Date: ${input.fetchedAt}`,
      `WARC-Record-ID: <urn:uuid:${randomUUID()}>`,
      "Content-Type: application/warc-fields",
      "Content-Length: 0",
      "",
      "",
    ].join("\r\n"),
  );
  const responseHead = encoder.encode(
    [
      "WARC/1.0",
      "WARC-Type: response",
      `WARC-Target-URI: ${input.target}`,
      `WARC-Date: ${input.fetchedAt}`,
      `WARC-Payload-Digest: sha256:${bodyHash}`,
      `WARC-Record-ID: <urn:uuid:${randomUUID()}>`,
      "Content-Type: application/http; msgtype=response",
      `Content-Length: ${responseContent.length}`,
      "",
      "",
    ].join("\r\n"),
  );
  const trailing = encoder.encode("\r\n\r\n");
  const out = new Uint8Array(warcinfo.length + responseHead.length + responseContent.length + trailing.length);
  out.set(warcinfo, 0);
  out.set(responseHead, warcinfo.length);
  out.set(responseContent, warcinfo.length + responseHead.length);
  out.set(trailing, out.length - trailing.length);
  return out;
}

/**
 * Stores the WARC container of every archived response of a TR-012 run as additional case
 * evidence (mime application/warc). The raw evidence stays untouched; the WARC cites the
 * same target URL and archive moment.
 */
export function storeWarcForRun(c: Case, requests: readonly StoredRequest[], origin: "network" | "sim" | "replay"): void {
  const byId = new Map<string, EvidenceRecord>();
  for (const entry of c.ledger.entries()) {
    if (entry.kind !== "evidence.stored") continue;
    const payload = entry.payload as unknown as EvidenceRecord & { id?: string };
    if (typeof payload.id === "string") byId.set(payload.id, payload as EvidenceRecord);
  }
  for (const req of requests) {
    const ev = byId.get(req.evidenceId);
    // only archived responses: a failed request has no body to containerize
    if (!ev || req.status === undefined) continue;
    const body = c.blobs.get(ev.sha256);
    const warc = warcArchiveBytes({
      target: req.url,
      fetchedAt: ev.fetchedAt,
      status: req.status,
      contentType: ev.mime,
      body,
    });
    c.addEvidence({
      bytes: warc,
      mime: "application/warc",
      request: { method: "GET", url: req.url, status: req.status },
      transformId: "tr-012",
      version: "1.0.0",
      fetchedAt: ev.fetchedAt,
      origin,
    });
  }
}
