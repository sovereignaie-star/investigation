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
import * as net from "node:net";
import * as tls from "node:tls";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import { EgressTransportError, type EgressProxyTunnel, type EgressTransport } from "./egress";

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

/**
 * ADR-31 (P2-028): a proxy-tunnel failure. The transport NEVER falls back to direct — a configured
 * route that cannot be established fails the request, and the gateway reports it as reason `proxy`.
 */
export class EgressProxyError extends EgressTransportError {
  constructor(stage: "connect" | "handshake" | "auth", message: string) {
    super("proxy", `node-transport proxy ${stage}: ${message}`);
    this.name = "EgressProxyError";
  }
}

/**
 * A persistent buffered reader for a tunnel socket (ADR-31/P2-028). A single 'data' listener keeps
 * the socket flowing and buffers everything; `readExact`/`readUntil` consume from the buffer. This
 * replaces per-read listeners — `socket.unshift()` on a paused (listener-less) socket provably never
 * delivers the buffered bytes, which deadlocked the SOCKS5 handshake.
 */
class SocketReader {
  private buffer: Buffer = Buffer.alloc(0);
  private waiter: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private failed: Error | null = null;
  private detach: () => void = () => {};

  constructor(
    private readonly sock: net.Socket,
    private readonly signal: AbortSignal | undefined,
  ) {
    const onData = (c: Buffer) => {
      this.buffer = this.buffer.length === 0 ? c : Buffer.concat([this.buffer, c]);
      this.wake();
    };
    const onError = (e?: Error) => {
      this.failed = e instanceof Error ? e : new EgressTransportError("transport_error", "tunnel socket closed");
      this.wake();
    };
    const onAbort = () => {
      this.failed = new EgressTransportError("transport_error", "tunnel handshake aborted");
      this.sock.destroy();
      this.wake();
    };
    this.sock.on("data", onData);
    this.sock.once("error", onError);
    this.sock.once("close", onError);
    this.signal?.addEventListener("abort", onAbort, { once: true });
    this.detach = () => {
      this.sock.off("data", onData);
      this.sock.off("error", onError);
      this.sock.off("close", onError);
      this.signal?.removeEventListener("abort", onAbort);
    };
  }

  /** Stop reading — call before handing the socket to the TLS layer. */
  stop(): void {
    this.detach();
  }

  private wake(): void {
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      if (this.failed) w.reject(this.failed);
      else w.resolve();
    }
  }

  /**
   * Resolves ONLY on NEW data (or failure) — never on already-buffered bytes. A wait that resolved
   * merely because data is buffered would spin the microtask loop while the I/O that completes the
   * read is stuck behind it (verified: a partial reply chunk deadlocked the read). Callers re-check
   * the buffer after every wake.
   */
  private waitForNewData(): Promise<void> {
    if (this.failed) return Promise.reject(this.failed);
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
  }

  async readExact(n: number): Promise<Buffer> {
    while (this.buffer.length < n) {
      await this.waitForNewData();
      if (this.failed) throw this.failed;
    }
    const out = this.buffer.subarray(0, n);
    this.buffer = this.buffer.subarray(n);
    return out;
  }

  async readUntil(delimiter: string): Promise<Buffer> {
    for (;;) {
      const at = this.buffer.indexOf(delimiter);
      if (at >= 0) {
        const end = at + delimiter.length;
        const out = this.buffer.subarray(0, end);
        this.buffer = this.buffer.subarray(end);
        return out;
      }
      if (this.failed) throw this.failed;
      await this.waitForNewData();
    }
  }
}

/** The request shape `EgressTransport.fetch` receives (the pinned IP, the optional tunnel, the signal). */
type EgressFetchRequest = Parameters<EgressTransport["fetch"]>[0];

/** The explicitly-allowed TLS fields for a tunnel socket — picked one by one, never a spread of caller input. */
function pickTunnelTlsOptions(tlsOptions: NodeTransportOptions["tlsOptions"]): tls.ConnectionOptions {
  return {
    ...(tlsOptions?.ca !== undefined ? { ca: tlsOptions.ca } : {}),
    ...(tlsOptions?.cert !== undefined ? { cert: tlsOptions.cert } : {}),
    ...(tlsOptions?.key !== undefined ? { key: tlsOptions.key } : {}),
    ...(tlsOptions?.ciphers !== undefined ? { ciphers: tlsOptions.ciphers } : {}),
    ...(tlsOptions?.minVersion !== undefined ? { minVersion: tlsOptions.minVersion } : {}),
    ...(tlsOptions?.maxVersion !== undefined ? { maxVersion: tlsOptions.maxVersion } : {}),
  };
}

/**
 * ADR-31 (P2-028): establishes the proxy tunnel — TCP to the proxy's PINNED IP, then HTTP CONNECT or
 * SOCKS5 toward the target (the PINNED IP in strict mode, the DOMAIN for Tor), then TLS verified
 * against the URL hostname. Fail-closed: any failure throws `EgressProxyError` — never a fallback.
 */
async function establishProxyTunnel(
  req: EgressFetchRequest,
  proxy: EgressProxyTunnel,
  u: URL,
  tlsOptions: NodeTransportOptions["tlsOptions"],
): Promise<tls.TLSSocket> {
  const targetPort = Number(u.port) || 443;
  const sock = net.connect({ host: proxy.proxyIp, port: proxy.proxyPort });
  // Fail-closed AND leak-free: an abort or a failure at ANY stage (connect, handshake, TLS) destroys
  // the socket; the abort listener stays bound until the tunnel is fully established.
  const onAbort = () => sock.destroy(new Error("aborted"));
  req.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      sock.once("error", (e) => reject(new EgressProxyError("connect", e.message)));
      sock.once("close", () => reject(new EgressProxyError("connect", "proxy closed the connection")));
      sock.once("connect", () => resolve());
    });
    const reader = new SocketReader(sock, req.signal);
    try {
      if (proxy.kind === "http-connect") await httpConnectHandshake(reader, sock, proxy, targetPort);
      else await socks5Handshake(reader, sock, proxy, targetPort);
    } finally {
      // hand the socket to TLS with NO reader still attached — the TLS layer owns it now.
      reader.stop();
    }
  } catch (err) {
    sock.destroy();
    throw err;
  } finally {
    req.signal?.removeEventListener("abort", onAbort);
  }
  const tunnelSock = tls.connect({
    socket: sock,
    servername: u.hostname,
    rejectUnauthorized: true,
    ...pickTunnelTlsOptions(tlsOptions),
  });
  const onTlsAbort = () => tunnelSock.destroy(new Error("aborted"));
  req.signal?.addEventListener("abort", onTlsAbort, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      tunnelSock.once("error", (e) => reject(new EgressProxyError("handshake", `TLS over the tunnel failed: ${e.message}`)));
      // an abort destroys the socket — 'close' must settle the wait too, or the handshake would hang.
      tunnelSock.once("close", () => reject(new EgressProxyError("handshake", "TLS socket closed before the handshake completed")));
      tunnelSock.once("secureConnect", () => resolve());
    });
  } catch (err) {
    tunnelSock.destroy();
    throw err;
  } finally {
    req.signal?.removeEventListener("abort", onTlsAbort);
  }
  return tunnelSock;
}

/** ADR-31 strict mode: HTTP CONNECT to the proxy, targeting the PINNED IP (the proxy never resolves DNS). */
async function httpConnectHandshake(reader: SocketReader, sock: net.Socket, proxy: EgressProxyTunnel, port: number): Promise<void> {
  const target = proxy.target.kind === "ip" ? proxy.target.ip : proxy.target.host;
  let head = `CONNECT ${target}:${port} HTTP/1.1\r\nHost: ${target}:${port}\r\n`;
  if (proxy.credentials)
    head += `Proxy-Authorization: Basic ${Buffer.from(`${proxy.credentials.username}:${proxy.credentials.password}`).toString("base64")}\r\n`;
  head += "\r\n";
  sock.write(head);
  const resp = await reader.readUntil("\r\n\r\n");
  const line = resp.toString("latin1").split("\r\n")[0];
  if (!/^HTTP\/1\.[01] 200/.test(line)) throw new EgressProxyError("handshake", `CONNECT refused: ${line}`);
}

/** ADR-31: SOCKS5 username/password auth (RFC 1929) — the only auth methods offered are 0x00 and 0x02. */
async function socks5Auth(reader: SocketReader, sock: net.Socket, proxy: EgressProxyTunnel): Promise<void> {
  const u = Buffer.from(proxy.credentials?.username ?? "", "utf8");
  const p = Buffer.from(proxy.credentials?.password ?? "", "utf8");
  if (u.length === 0 || u.length > 255 || p.length > 255) throw new EgressProxyError("auth", "invalid SOCKS5 credentials");
  sock.write(Buffer.concat([Buffer.from([0x01, u.length]), u, Buffer.from([p.length]), p]));
  const status = await reader.readExact(2);
  if (status[0] !== 0x01 || status[1] !== 0x00) throw new EgressProxyError("auth", "SOCKS5 username/password rejected");
}

/** Encodes the SOCKS5 CONNECT target: strict mode = the PINNED IPv4 (ATYP 0x01); Tor = the DOMAIN (ATYP 0x03). */
function socks5TargetBytes(proxy: EgressProxyTunnel): number[] {
  const req: number[] = [0x05, 0x01, 0x00];
  if (proxy.target.kind === "ip") {
    const parts = proxy.target.ip.split(".");
    if (parts.length === 4 && parts.every((x) => /^\d{1,3}$/.test(x))) {
      req.push(0x01, ...parts.map((x) => Number(x)));
      return req;
    }
    // an IPv6 or otherwise non-IPv4 pin — TOR NEVER SEES ONE (domain targets only); refuse rather than guess.
    throw new EgressProxyError("handshake", "unsupported pinned address family for SOCKS5");
  }
  const name = Buffer.from(proxy.target.host, "utf8");
  if (name.length === 0 || name.length > 255) throw new EgressProxyError("handshake", "invalid target domain");
  req.push(0x03, name.length, ...name);
  return req;
}

/** Consumes the SOCKS5 reply's bound address — it is never used for verification. */
async function skipSocks5BoundAddress(reader: SocketReader, atyp: number): Promise<void> {
  if (atyp === 0x01) await reader.readExact(4 + 2);
  else if (atyp === 0x03) {
    const len = (await reader.readExact(1))[0];
    await reader.readExact(len + 2);
  } else if (atyp === 0x04) await reader.readExact(16 + 2);
  else throw new EgressProxyError("handshake", `unknown SOCKS5 reply ATYP ${atyp}`);
}

/** ADR-31: SOCKS5 (RFC 1928) — strict mode targets the PINNED IP; Tor targets the DOMAIN (ATYP 0x03). */
async function socks5Handshake(reader: SocketReader, sock: net.Socket, proxy: EgressProxyTunnel, port: number): Promise<void> {
  // greeting: we accept no-auth (0x00) and username/password (0x02) only — never anything else.
  sock.write(Buffer.from([0x05, 0x02, 0x00, 0x02]));
  const choice = await reader.readExact(2);
  if (choice[0] !== 0x05) throw new EgressProxyError("handshake", `bad SOCKS version ${choice[0]}`);
  if (choice[1] === 0xff) throw new EgressProxyError("auth", "no acceptable SOCKS5 auth method");
  if (choice[1] === 0x02) await socks5Auth(reader, sock, proxy);
  else if (choice[1] !== 0x00) {
    throw new EgressProxyError("handshake", `unsupported SOCKS5 method 0x${choice[1].toString(16)}`);
  }
  // request: CONNECT to the target (IP literal or domain — never resolved here).
  const req = socks5TargetBytes(proxy);
  req.push(port >> 8, port & 0xff);
  sock.write(Buffer.from(req));
  const head = await reader.readExact(4);
  if (head[0] !== 0x05) throw new EgressProxyError("handshake", `bad SOCKS reply version ${head[0]}`);
  if (head[1] !== 0x00) throw new EgressProxyError("handshake", `SOCKS5 CONNECT failed with status 0x${head[1].toString(16)}`);
  await skipSocks5BoundAddress(reader, head[3]);
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

      // ADR-31 (P2-028): a proxied request is established through the tunnel FIRST (see
      // establishProxyTunnel), and TLS is verified against the URL hostname over the tunnel.
      // There is NO direct fallback: a tunnel that cannot be established fails the request.
      let agent: https.Agent | undefined;
      let tunnel: tls.TLSSocket | undefined;
      const requestOpts: https.RequestOptions = { signal: req.signal };
      if (req.proxy !== undefined) {
        const tlsSock = await establishProxyTunnel(req, req.proxy, u, opts.tlsOptions);
        tunnel = tlsSock;
        // The request-level `createConnection` option is ignored when an agent is active, and
        // `agent: false` still runs the default DNS path (ENOTFOUND for our deliberately
        // unresolvable hosts). A dedicated Agent whose connection IS the established tunnel
        // socket is the only path that provably performs zero DNS — the socket already exists.
        class TunnelAgent extends https.Agent {
          createConnection(
            _options: https.RequestOptions,
            callback?: (err: Error | null, stream: import("node:stream").Duplex) => void,
          ): import("node:stream").Duplex | null {
            callback?.(null, tlsSock);
            return tlsSock;
          }
        }
        agent = new TunnelAgent({ keepAlive: false });
        requestOpts.agent = agent;
      } else {
        // --- direct (ADR-08): connect to the pinned IP with SNI/hostname verification ---
        const tls = opts.tlsOptions;
        agent = new https.Agent({
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
        requestOpts.agent = agent;
        requestOpts.servername = u.hostname;
        requestOpts.rejectUnauthorized = true;
      }

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
              // Direct: the pinned-IP agent; tunnel: the agent whose socket IS the established
              // tunnel. `rejectUnauthorized` stays true for the direct path (set after the spread).
              ...requestOpts,
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

          // ADR-27: the OAuth2 token POST body — the only request body the gateway ever sends
          // (form-urlencoded, project secrets only). Written once, then the request ends.
          if (req.body !== undefined && req.method === "POST") request.write(req.body);
          request.end();
        },
      ).finally(() => {
        agent?.destroy();
        tunnel?.destroy();
      });
    },
  };
}
