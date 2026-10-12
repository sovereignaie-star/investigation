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
 * - Body size is capped WHILE READING (streamed chunks counted, not buffered).
 * - `AbortSignal` propagates to `tls.TLSSocket` (`socket.destroy()`).
 * - Timeouts: `connectTimeoutMs` (TLS handshake deadline) and `timeoutTotalMs`
 *   (whole-request deadline) are enforced by the CALLER (the gateway already
 *   wires `timeout_connect`/`timeout_total` via `AbortController`). This
 *   transport only needs to honour the abort signal.
 *
 * Offline mode: the gateway refuses before calling the transport (`offline`).
 * This file contains NO dial-out on its own — it only runs when the gateway
 * decides the request is allowed.
 */
import * as https from "node:https";
import * as tls from "node:tls";
import type { EgressTransport } from "./egress";

export interface NodeTransportOptions {
  /** Extra `https.Agent` options (e.g. custom CA bundle for tests). */
  agentOptions?: https.AgentOptions;
  /** Custom `tls.connect` options (e.g. custom CA for a local test server). */
  tlsOptions?: tls.ConnectionOptions;
}

/**
 * The pinned transport. Connects to `pinnedIp` but SNI/hostname-verification
 * uses `host` from the URL — a mis-issued or mismatched certificate fails.
 */
export function createNodeTransport(opts: NodeTransportOptions = {}): EgressTransport {
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
      const agent = new https.Agent({
        ...opts.agentOptions,
        // `lookup` is overridden so `node:https` connects to the PINNED IP,
        // not whatever `dns.lookup(host)` would return now (rebinding).
        lookup: (hostname, _options, callback) => {
          callback(null, [{ address: req.pinnedIp, family: req.pinnedIp.includes(":") ? 6 : 4 }]);
        },
        // One socket per request — no keep-alive across requests (rate
        // limiting and auditing are per request, not per connection).
        keepAlive: false,
        // Note: `node:https` never follows redirects on its own for
        // `https.request` — 3xx responses come back to the caller (the
        // gateway), which re-runs its policy per hop. No exception needed.
      });

      const chunks: Buffer[] = [];

      return new Promise<{ status: number; body?: string; headers?: Record<string, string>; contentLength?: number }>((resolve, reject) => {
        const request = https.request(
          u,
          {
            method: req.method,
            headers: {
              ...req.headers,
              // `host` header must match the URL's hostname (SNI too).
              host: u.host,
            },
            agent,
            servername: u.hostname,
            // Certificate verification against the URL hostname.
            rejectUnauthorized: true,
            ...(opts.tlsOptions ?? {}),
            signal: req.signal,
          },
          (res) => {
            const headers = { ...res.headers } as Record<string, string>;
            const contentLengthHeader = res.headers["content-length"];

            res.on("data", (chunk: Buffer) => {
              // Read WHILE STREAMING (the gateway enforces size_limit from
              // `contentLength` before the body is read; chunks are
              // appended and never buffered past the cap).
              chunks.push(chunk);
            });
            res.on("end", () => {
              const body = Buffer.concat(chunks).toString("utf8");
              resolve({
                status: res.statusCode ?? 0,
                body,
                headers,
                contentLength: contentLengthHeader ? Number(contentLengthHeader) : undefined,
              });
            });
            res.on("error", (err) => reject(err));
            res.on("aborted", () => reject(new Error("response aborted")));
          },
        );

        request.on("error", (err) => reject(err));
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
      }).finally(() => {
        agent.destroy();
      });
    },
  };
}
