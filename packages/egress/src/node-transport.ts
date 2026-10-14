/**
 * REAL transport inside @ir/egress — P2-003 section 4.
 *
 * Implements `EgressTransport` with `node:https`/`node:tls` against a PINNED IP.
 *
 * Design notes (ADR-08):
 * - The gateway resolves DNS, pins the IP (checked against address-policy), and
 *   hands this transport a `pinnedIp`. We connect to that IP, and **verify the
 *   TLS certificate against the HOSTNAME in the URL** (`servername` + default
 *   `checkServerIdentity`) — the certificate must match the hostname the caller
 *   asked for, not just any cert signed by a CA we trust.
 * - Redirects are NOT followed here. The gateway drives redirects through its own
 *   policy (pinned-host re-check, scheme/port re-check, redirect limit) by
 *   calling this transport once per hop. A 3xx response is returned to the
 *   gateway so it can decide.
 * - No `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` — `node:https` does not read
 *   them by default, and we never pass a proxy agent.
 * - Body size is capped WHILE READING (streamed chunks counted; past the cap
 *   the response stream is destroyed and the request REJECTS with `size_limit`).
 * - `AbortSignal` propagates to the socket (`request.destroy()`).
 * - TLS options are NOT spread after `rejectUnauthorized`/`servername` — a
 *   caller cannot weaken verification or override the pinned `lookup`.
 * - Offline mode: the gateway refuses before calling the transport (`offline`).
 *   This file contains NO dial-out on its own — it only runs when the gateway
 *   decides the request is allowed.
 */
import * as https from "node:https";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import { EgressTransportError, type EgressTransport } from "./egress";

/** Explicit User-Agent (ADR-08): identifies the tool, never carries case data. A caller-provided one wins. */
export const DEFAULT_USER_AGENT = "InvestigationRoom-egress/1";

/** At most this many stacked content-encoding layers are decoded; more is refused (T-SEC-SSRF-033). */
export const MAX_ENCODING_LAYERS = 2;

/**
 * Decode a body according to its Content-Encoding header (RFC 9110 8.4: codings are listed in the order they were
 * applied, so they are removed in reverse). Every layer is bounded by `maxDecodedBytes` WHILE decoding
 * (`maxOutputLength`), so a decompression bomb is stopped at the cap instead of being inflated in memory first.
 * An unknown coding or too many layers is refused (fail-closed): the caller could not read the body anyway.
 */
export function decodeBody(raw: Buffer, contentEncoding: string | undefined, maxDecodedBytes: number): Buffer {
  const codings = String(contentEncoding ?? "")
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c !== "" && c !== "identity");
  if (codings.length > MAX_ENCODING_LAYERS) {
    throw new EgressTransportError("content_encoding", `egress: ${codings.length} stacked content-encodings (max ${MAX_ENCODING_LAYERS})`);
  }
  let buf = raw;
  for (const coding of codings.reverse()) {
    const limit = { maxOutputLength: maxDecodedBytes + 1 };
    try {
      if (coding === "gzip" || coding === "x-gzip") buf = gunzipSync(buf, limit);
      else if (coding === "deflate") buf = inflateSync(buf, limit);
      else if (coding === "br") buf = brotliDecompressSync(buf, limit);
      else throw new EgressTransportError("content_encoding", `egress: unsupported content-encoding "${coding}"`);
    } catch (e) {
      if (e instanceof EgressTransportError) throw e;
      // zlib reports an output over maxOutputLength as a RangeError (ERR_BUFFER_TOO_LARGE).
      if (e instanceof RangeError) throw new EgressSizeLimitError("decoded");
      throw new EgressTransportError("content_encoding", `egress: decoding "${coding}" failed: ${(e as Error).message}`);
    }
    if (buf.length > maxDecodedBytes) throw new EgressSizeLimitError("decoded");
  }
  return buf;
}

export type NodeTransportTlsOptions = Pick<https.AgentOptions, "ca" | "cert" | "key" | "ciphers" | "minVersion" | "maxVersion" | "timeout">;

export interface NodeTransportOptions {
  /**
   * Byte cap for the response body WHILE READING (RAW bytes off the wire,
   * pre-decompression). When exceeded, the stream is destroyed and the
   * transport REJECTS with a `size_limit` error (no truncated success).
   * The gateway re-checks `contentLength` before the body; this cap is the
   * enforcement for chunked/no-content-length bodies.
   */
  readonly maxBodyBytes?: number;
  /**
   * Byte cap for the body AFTER decompression (the actual payload size).
   * Enforced against gzip bombs and decompressed payloads that are far
   * larger than their compressed wire size. Defaults to 50 MiB (the ADR-08
   * "absolute cap in gateway code").
   */
  readonly maxDecodedBytes?: number;
  /** TLS options. Deliberately a narrow type — `rejectUnauthorized` cannot be set. */
  readonly tlsOptions?: NodeTransportTlsOptions;
}

export class EgressSizeLimitError extends EgressTransportError {
  constructor(stage: "wire" | "decoded" = "wire") {
    super(
      "size_limit",
      stage === "wire"
        ? "egress size_limit: response body exceeded maxBodyBytes while reading"
        : "egress size_limit: decoded body exceeded maxDecodedBytes while decoding",
    );
    this.name = "EgressSizeLimitError";
  }
}

/**
 * The pinned transport. Connects to `pinnedIp` but SNI/hostname-verification
 * uses `host` from the URL — a mis-issued or mismatched certificate fails.
 */
export function createNodeTransport(opts: NodeTransportOptions = {}): EgressTransport {
  const maxBodyBytes = opts.maxBodyBytes ?? 5 * 1024 * 1024; // 5 MiB default (ADR-08)
  const maxDecodedBytes = opts.maxDecodedBytes ?? 50 * 1024 * 1024; // 50 MiB absolute cap (ADR-08)
  return {
    async fetch(req) {
      const u = new URL(req.url);
      // Only https: is allowed by the gateway (scheme check). The transport
      // refuses anything else defensively — no cleartext http hop.
      if (u.protocol !== "https:") {
        throw new Error(`node-transport: refused non-https scheme (${u.protocol})`);
      }

      // Per-request socket-level control. `rejectUnauthorized` stays true —
      // the default. The transport never disables certificate verification.
      // NOTE: `opts.tlsOptions` is NOT spread — each allowed field is picked
      // EXPLICITLY. A JavaScript caller could otherwise inject
      // `checkServerIdentity` or `rejectUnauthorized: false` via the spread.
      const tls = opts.tlsOptions;
      const agent = new https.Agent({
        // ONLY the fields the transport explicitly allows — never a spread.
        ca: tls?.ca,
        cert: tls?.cert,
        key: tls?.key,
        ciphers: tls?.ciphers,
        minVersion: tls?.minVersion,
        maxVersion: tls?.maxVersion,
        timeout: tls?.timeout,
        // `lookup` is overridden so `node:https` connects to the PINNED IP,
        // not whatever `dns.lookup(host)` would return now (rebinding).
        lookup: ((_hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
          const family = req.pinnedIp.includes(":") ? 6 : 4;
          // net calls lookup with `all: true` (autoSelectFamily) or without it; answer in the shape it asked for.
          if (options?.all) callback(null, [{ address: req.pinnedIp, family }]);
          else callback(null, req.pinnedIp, family);
        }) as unknown as https.AgentOptions["lookup"],
        // One socket per request — no keep-alive across requests (rate
        // limiting and auditing are per request, not per connection).
        keepAlive: false,
      });

      const chunks: Buffer[] = [];
      let received = 0; // raw bytes read off the wire (pre-decompression)
      let capped = false;
      // P2-039: the tighter of this transport's own cap and the gateway's per-response cap for this hop.
      const wireCap = Math.min(maxBodyBytes, req.maxBodyBytes ?? Number.POSITIVE_INFINITY);
      const decodedCap = Math.min(maxDecodedBytes, req.maxBodyBytes ?? Number.POSITIVE_INFINITY);

      return await new Promise<{ status: number; body?: string; headers?: Record<string, string>; contentLength?: number }>(
        (resolve, reject) => {
          const request = https.request(
            u,
            {
              method: req.method,
              headers: {
                "user-agent": DEFAULT_USER_AGENT,
                ...req.headers,
                // `host` header must match the URL's hostname (SNI too).
                host: u.host,
              },
              agent,
              // Certificate verification against the URL hostname — set AFTER
              // the spread so a caller cannot override them.
              servername: u.hostname,
              rejectUnauthorized: true,
              signal: req.signal,
            },
            (res) => {
              const headers = { ...res.headers } as Record<string, string>;
              const contentLengthHeader = res.headers["content-length"];

              res.on("data", (chunk: Buffer) => {
                received += chunk.length;
                // Cap WHILE READING — do not buffer past the cap. On overflow,
                // destroy the stream and REJECT (fail-closed, no truncated
                // success).
                if (received > wireCap) {
                  capped = true;
                  res.destroy();
                  request.destroy();
                  reject(new EgressSizeLimitError());
                  return;
                }
                // P2-039: the shared byte budget is charged per chunk; the chunk that would pass it is not kept.
                if (req.meter && !req.meter(chunk.length)) {
                  capped = true;
                  res.destroy();
                  request.destroy();
                  reject(new EgressTransportError("byte_budget", "egress byte_budget: the response would pass the remaining byte budget"));
                  return;
                }
                chunks.push(chunk);
              });
              res.on("end", () => {
                if (capped) return; // already rejected
                const raw = Buffer.concat(chunks);
                let bodyBuf: Buffer;
                try {
                  bodyBuf = decodeBody(raw, headers["content-encoding"], decodedCap);
                } catch (e) {
                  reject(e);
                  return;
                }
                // A decoded body larger than its wire size: the difference is charged too (budget >= max(wire, decoded)).
                if (req.meter && bodyBuf.length > received && !req.meter(bodyBuf.length - received)) {
                  reject(
                    new EgressTransportError(
                      "byte_budget",
                      "egress byte_budget: the decoded response would pass the remaining byte budget",
                    ),
                  );
                  return;
                }
                resolve({
                  status: res.statusCode ?? 0,
                  body: bodyBuf.toString("utf8"),
                  headers,
                  contentLength: contentLengthHeader ? Number(contentLengthHeader) : undefined,
                });
              });
              res.on("error", (err) => {
                if (capped) return;
                reject(err);
              });
              res.on("aborted", () => {
                if (capped) return;
                reject(new Error("response aborted"));
              });
            },
          );

          request.on("error", (err) => {
            if (capped) return;
            reject(err);
          });
          request.on("timeout", () => {
            request.destroy(new Error("node-transport: connect timeout"));
          });

          // The caller's AbortSignal destroys the socket — the transport
          // never swallows cancellation.
          req.signal?.addEventListener(
            "abort",
            () => {
              request.destroy(req.signal?.reason ?? new Error("aborted"));
            },
            { once: true },
          );

          request.end();
        },
      ).finally(() => {
        agent.destroy();
      });
    },
  };
}
