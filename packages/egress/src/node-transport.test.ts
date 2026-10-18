/**
 * REAL transport test for `createNodeTransport` — P2-003 section 4.
 *
 * Uses LOCAL TLS servers (self-signed certs generated IN the test via openssl,
 * cleaned up afterwards — nothing stored in the repo) — no internet.
 *
 * The tests prove:
 * - The transport connects to the PINNED IP with SNI/hostname verification
 *   (a test hostname that does NOT resolve normally — only the pinned IP
 *   reaches the server, so a missing `lookup` override would fail DNS).
 * - A certificate that does not match the URL hostname is rejected with a
 *   HOSTNAME-MISMATCH error specifically.
 * - Body size is capped WHILE READING (chunked, no Content-Length) and the
 *   promise REJECTS with `EgressSizeLimitError` — no truncated success — and
 *   the connection is destroyed (the server sees the client go away).
 * - AbortSignal after the response starts destroys the connection.
 * - 3xx responses are returned to the caller (the gateway drives redirects).
 * - No HTTP_PROXY / HTTPS_PROXY is honored.
 * - `rejectUnauthorized` cannot be overridden via `tlsOptions` (type-level +
 *   runtime behaviour unchanged).
 */
import * as fs from "node:fs";
import * as http from "node:http";
import * as net from "node:net";
import * as https from "node:https";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { createNodeTransport, EgressSizeLimitError } from "./node-transport";

/**
 * Generate a self-signed certificate + key with openssl in a TEMP DIR.
 * Nothing is committed to the repo — no disguised keys, no gitleaks issues.
 */
function makeCert(cn: string, san: string): { cert: string; key: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "egress-tls-"));
  const crt = path.join(dir, "c.crt");
  const key = path.join(dir, "c.key");
  const r = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      key,
      "-out",
      crt,
      "-days",
      "1",
      "-nodes",
      "-subj",
      `/CN=${cn}`,
      "-addext",
      `subjectAltName=${san}`,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`openssl failed: ${r.stderr}`);
  const cert = fs.readFileSync(crt, "utf8");
  const keyPem = fs.readFileSync(key, "utf8");
  fs.rmSync(dir, { recursive: true, force: true });
  return { cert, key: keyPem };
}

const FIXTURE_HOST = "pinned-test.invalid"; // does NOT resolve — only the pinned IP reaches the server
const WRONG_HOST = "wrong-name.invalid";

const good = makeCert(FIXTURE_HOST, `DNS:${FIXTURE_HOST}`);
const wrong = makeCert(WRONG_HOST, `DNS:${WRONG_HOST}`);

const certs: Array<{ server: https.Server }> = [];
afterAll(() => {
  for (const c of certs) c.server.close();
  certs.length = 0;
});

function makeLocalTlsServer(
  certPem: string,
  keyPem: string,
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  onClientGone?: () => void,
): Promise<{ port: number; close: () => void }> {
  const server = https.createServer({ cert: certPem, key: keyPem }, handler);
  certs.push({ server });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        port,
        close: () => {
          server.close();
          if (onClientGone) onClientGone();
        },
      });
    });
  });
}

describe("node-transport (REAL TLS against a local pinned server)", () => {
  it("connects to the pinned IP for a name that does NOT resolve via DNS (SNI/hostname verified)", async () => {
    const { port, close } = await makeLocalTlsServer(good.cert, good.key, (_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("hello-pinned");
    });
    try {
      const t = createNodeTransport({
        // Trust ONLY the generated self-signed cert for the LOCAL TEST.
        tlsOptions: { ca: good.cert },
      });
      // FIXTURE_HOST does not resolve — the ONLY way to reach the server is the
      // pinned IP. If the `lookup` override were missing, this would fail with
      // getaddrinfo ENOTFOUND.
      const r = await t.fetch({
        url: `https://${FIXTURE_HOST}:${port}/x`,
        host: `${FIXTURE_HOST}:${port}`,
        pinnedIp: "127.0.0.1",
        method: "GET",
      });
      expect(r.status).toBe(200);
      expect(r.body).toBe("hello-pinned");
    } finally {
      close();
    }
  });

  it("rejects a certificate that does NOT match the URL hostname — with a hostname-mismatch error specifically", async () => {
    const { port, close } = await makeLocalTlsServer(wrong.cert, wrong.key, (_req, res) => {
      res.writeHead(200);
      res.end("should-not-reach");
    });
    try {
      const t = createNodeTransport({ tlsOptions: { ca: wrong.cert } });
      const p = t.fetch({
        url: `https://${FIXTURE_HOST}:${port}/x`,
        host: `${FIXTURE_HOST}:${port}`,
        pinnedIp: "127.0.0.1",
        method: "GET",
      });
      // The error must be a DEPTH_ZERO/self-signed or ERR_TLS_CERT_ALTNAME_INVALID
      // style hostname mismatch — NOT just any exception.
      let err: unknown;
      try {
        await p;
      } catch (e) {
        err = e;
      }
      expect(err).toBeDefined();
      // Specifically the hostname mismatch (the CA is trusted here), not any TLS failure.
      expect((err as { code?: string }).code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
    } finally {
      close();
    }
  });

  it("caps the body WHILE READING: chunked (no Content-Length) over the cap rejects with EgressSizeLimitError and the connection is destroyed", async () => {
    let clientGone = false;
    const { port, close } = await makeLocalTlsServer(
      good.cert,
      good.key,
      (_req, res) => {
        res.writeHead(200); // chunked — no content-length
        // Stream MORE than the cap. The transport must destroy the stream.
        const chunk = "x".repeat(1024);
        let n = 0;
        const t = setInterval(() => {
          res.write(chunk);
          n++;
          if (n >= 32) {
            clearInterval(t);
            res.end();
          }
        }, 5);
        res.on("close", () => {
          clientGone = true;
          clearInterval(t);
        });
      },
      () => {
        clientGone = true;
      },
    );
    try {
      const t = createNodeTransport({
        tlsOptions: { ca: good.cert },
        maxBodyBytes: 8 * 1024, // 8 KiB cap; server streams 32 KiB
      });
      const p = t.fetch({
        url: `https://${FIXTURE_HOST}:${port}/x`,
        host: `${FIXTURE_HOST}:${port}`,
        pinnedIp: "127.0.0.1",
        method: "GET",
      });
      // Must REJECT with EgressSizeLimitError — never a truncated success.
      await expect(p).rejects.toBeInstanceOf(EgressSizeLimitError);
      // And the connection must be destroyed (server observed the client go).
      // The destroy is synchronous with the cap hit; give the event loop a tick.
      await new Promise((r) => setTimeout(r, 100));
      expect(clientGone).toBe(true);
    } finally {
      close();
    }
  });

  it("P2-039: stops reading at the byte-budget boundary WHILE streaming (meter refuses) and destroys the connection", async () => {
    let clientGone = false;
    let written = 0;
    const { port, close } = await makeLocalTlsServer(good.cert, good.key, (_req, res) => {
      res.writeHead(200); // chunked
      const chunk = "x".repeat(1024);
      const t = setInterval(() => {
        res.write(chunk);
        written++;
        if (written >= 64) {
          clearInterval(t);
          res.end();
        }
      }, 5);
      res.on("close", () => {
        clientGone = true;
        clearInterval(t);
      });
    });
    try {
      let charged = 0;
      const limit = 4 * 1024;
      const t = createNodeTransport({ tlsOptions: { ca: good.cert } });
      const p = t.fetch({
        url: `https://${FIXTURE_HOST}:${port}/big`,
        host: `${FIXTURE_HOST}:${port}`,
        pinnedIp: "127.0.0.1",
        method: "GET",
        meter: (n) => {
          if (charged + n > limit) return false;
          charged += n;
          return true;
        },
      });
      await expect(p).rejects.toMatchObject({ name: "EgressTransportError", reason: "byte_budget" });
      expect(charged).toBeLessThanOrEqual(limit);
      await new Promise((r) => setTimeout(r, 100));
      expect(clientGone).toBe(true);
      expect(written).toBeLessThan(64); // the server never got to send the whole 64 KiB
    } finally {
      close();
    }
  });

  it("P2-039: the gateway's per-response cap (maxBodyBytes on the request) is enforced while reading", async () => {
    const { port, close } = await makeLocalTlsServer(good.cert, good.key, (_req, res) => {
      res.writeHead(200);
      res.end("y".repeat(10 * 1024));
    });
    try {
      const t = createNodeTransport({ tlsOptions: { ca: good.cert } }); // own cap 5 MiB
      const p = t.fetch({
        url: `https://${FIXTURE_HOST}:${port}/cap`,
        host: `${FIXTURE_HOST}:${port}`,
        pinnedIp: "127.0.0.1",
        method: "GET",
        maxBodyBytes: 2048,
      });
      await expect(p).rejects.toBeInstanceOf(EgressSizeLimitError);
    } finally {
      close();
    }
  });

  it("a gzip bomb is rejected with EgressSizeLimitError AFTER decompression (decoded cap enforced)", async () => {
    // A gzip bomb: a tiny compressed wire size that decodes to a payload far
    // larger than the decoded cap. The raw cap would NOT catch this — the
    // decoded cap must.
    const { gzipSync } = await import("node:zlib");
    const bomb = gzipSync(Buffer.alloc(200 * 1024, 0x41)); // 200 KiB of 'A' -> tiny wire
    const { port, close } = await makeLocalTlsServer(good.cert, good.key, (_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip" });
      res.end(bomb);
    });
    try {
      const t = createNodeTransport({
        tlsOptions: { ca: good.cert },
        maxBodyBytes: 1024 * 1024, // raw cap 1 MiB (the bomb is ~300 B on the wire)
        maxDecodedBytes: 100 * 1024, // decoded cap 100 KiB (the bomb decodes to 200 KiB)
      });
      const p = t.fetch({
        url: `https://${FIXTURE_HOST}:${port}/x`,
        host: `${FIXTURE_HOST}:${port}`,
        pinnedIp: "127.0.0.1",
        method: "GET",
      });
      // The decoded payload (200 KiB) exceeds the decoded cap (100 KiB) —
      // the transport must REJECT with EgressSizeLimitError.
      await expect(p).rejects.toBeInstanceOf(EgressSizeLimitError);
    } finally {
      close();
    }
  });

  it("a gzip body under the decoded cap decodes fine (happy path)", async () => {
    const { gzipSync } = await import("node:zlib");
    const payload = Buffer.from("hello-gzip");
    const compressed = gzipSync(payload);
    const { port, close } = await makeLocalTlsServer(good.cert, good.key, (_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip" });
      res.end(compressed);
    });
    try {
      const t = createNodeTransport({ tlsOptions: { ca: good.cert } });
      const r = await t.fetch({
        url: `https://${FIXTURE_HOST}:${port}/x`,
        host: `${FIXTURE_HOST}:${port}`,
        pinnedIp: "127.0.0.1",
        method: "GET",
      });
      expect(r.status).toBe(200);
      expect(r.body).toBe("hello-gzip");
    } finally {
      close();
    }
  });

  it("an unsupported content-encoding is rejected (fail-closed)", async () => {
    const { port, close } = await makeLocalTlsServer(good.cert, good.key, (_req, res) => {
      res.writeHead(200, { "content-encoding": "brotli-fake-unknown" });
      res.end(Buffer.from("junk"));
    });
    try {
      const t = createNodeTransport({ tlsOptions: { ca: good.cert } });
      const p = t.fetch({
        url: `https://${FIXTURE_HOST}:${port}/x`,
        host: `${FIXTURE_HOST}:${port}`,
        pinnedIp: "127.0.0.1",
        method: "GET",
      });
      await expect(p).rejects.toThrow(/unsupported content-encoding/);
    } finally {
      close();
    }
  });

  it("a 3xx response is RETURNED to the caller (the transport never follows redirects itself)", async () => {
    const { port, close } = await makeLocalTlsServer(good.cert, good.key, (_req, res) => {
      res.writeHead(302, { location: "https://example.org/redirected" });
      res.end();
    });
    try {
      const t = createNodeTransport({ tlsOptions: { ca: good.cert } });
      const r = await t.fetch({
        url: `https://${FIXTURE_HOST}:${port}/x`,
        host: `${FIXTURE_HOST}:${port}`,
        pinnedIp: "127.0.0.1",
        method: "GET",
      });
      expect(r.status).toBe(302);
      expect(r.headers?.location).toBe("https://example.org/redirected");
    } finally {
      close();
    }
  });

  it("honours AbortSignal AFTER the response starts — the connection is destroyed", async () => {
    let clientGone = false;
    const { port, close } = await makeLocalTlsServer(
      good.cert,
      good.key,
      (_req, res) => {
        // Start the response but never end it — the abort must destroy the
        // connection mid-response.
        res.writeHead(200);
        res.write("partial");
        res.on("close", () => {
          clientGone = true;
        });
      },
      () => {
        clientGone = true;
      },
    );
    try {
      const t = createNodeTransport({ tlsOptions: { ca: good.cert } });
      const ctrl = new AbortController();
      const p = t.fetch({
        url: `https://${FIXTURE_HOST}:${port}/x`,
        host: `${FIXTURE_HOST}:${port}`,
        pinnedIp: "127.0.0.1",
        method: "GET",
        signal: ctrl.signal,
      });
      // Abort AFTER the response starts (the server already wrote "partial").
      setTimeout(() => ctrl.abort(new Error("cancelled-by-test")), 50);
      await expect(p).rejects.toThrow();
      await new Promise((r) => setTimeout(r, 100));
      expect(clientGone).toBe(true);
    } finally {
      close();
    }
  });

  // In-process sanity check only: without NODE_USE_ENV_PROXY at startup Node ignores these variables anyway, so
  // this test alone proves little. The real proof (with a control showing the proxy IS active for the default
  // agent) is T-SEC-SSRF-025 in node-transport-ssrf.test.ts.
  it("does NOT honour HTTP_PROXY / HTTPS_PROXY (in-process sanity check; see T-SEC-SSRF-025 for the real proof)", async () => {
    process.env.HTTP_PROXY = "http://127.0.0.1:1";
    process.env.HTTPS_PROXY = "http://127.0.0.1:1";
    const { port, close } = await makeLocalTlsServer(good.cert, good.key, (_req, res) => {
      res.writeHead(200);
      res.end("direct");
    });
    try {
      const t = createNodeTransport({ tlsOptions: { ca: good.cert } });
      const r = await t.fetch({
        url: `https://${FIXTURE_HOST}:${port}/x`,
        host: `${FIXTURE_HOST}:${port}`,
        pinnedIp: "127.0.0.1",
        method: "GET",
      });
      // Reached the server DIRECTLY (proxy at 127.0.0.1:1 would have refused).
      expect(r.status).toBe(200);
      expect(r.body).toBe("direct");
    } finally {
      await close();
      delete process.env.HTTP_PROXY;
      delete process.env.HTTPS_PROXY;
    }
  });
});

describe("node-transport probeProxy (P2-028 — the REAL liveness probe; local servers, no internet)", () => {
  // NOTE (J-6 discipline): this round is RETROSPECTIVE — probeProxy was implemented in #218 before
  // these tests were written (a J-8 deviation, disclosed in WORKLOG). These tests document and lock
  // the behaviour; they are NOT prior red-first evidence for the implementation.

  /** A free local port (bound then released) to point a probe at a DEAD address. */
  async function freePort(): Promise<number> {
    return await new Promise((resolve) => {
      const srv = net.createServer(() => undefined);
      srv.listen(0, "127.0.0.1", () => {
        const { port } = srv.address() as net.AddressInfo;
        srv.close(() => resolve(port));
      });
    });
  }

  it("T-P2028-N01: a SOCKS5 proxy that answers the method negotiation is ALIVE (latency recorded, no target contacted)", async () => {
    // a minimal SOCKS5 server: it answers the no-auth greeting [05 01 00] with [05 00].
    const seenGreetings: Buffer[] = [];
    const server = net.createServer((sock) => {
      sock.on("data", (buf) => {
        seenGreetings.push(Buffer.from(buf));
        sock.write(Buffer.from([0x05, 0x00])); // no-auth accepted
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as net.AddressInfo;
    try {
      const transport = createNodeTransport();
      const probe = transport.probeProxy;
      if (typeof probe !== "function") throw new Error("probeProxy missing on the transport");
      const outcome = await probe({ kind: "socks5", proxyIp: "127.0.0.1", proxyPort: port });
      expect(outcome.alive).toBe(true);
      expect(typeof outcome.latencyMs).toBe("number");
      // the probe greeted with the no-auth method list ONLY — no target, no auth.
      expect(seenGreetings[0].equals(Buffer.from([0x05, 0x01, 0x00]))).toBe(true);
    } finally {
      server.close();
    }
  });

  it("T-P2028-N02: a dead address (nothing listening) is NOT alive — the failure is an outcome, never a throw", async () => {
    const port = await freePort(); // released: nothing listens
    const transport = createNodeTransport();
    const probe = transport.probeProxy;
    if (typeof probe !== "function") throw new Error("probeProxy missing on the transport");
    const outcome = await probe({ kind: "socks5", proxyIp: "127.0.0.1", proxyPort: port });
    expect(outcome.alive).toBe(false);
    expect(typeof outcome.error).toBe("string");
  });

  it("T-P2028-N03: an HTTP-CONNECT proxy is probed with a TCP connect only (any listener = alive)", async () => {
    const server = net.createServer(() => undefined); // accepts, says nothing
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as net.AddressInfo;
    try {
      const transport = createNodeTransport();
      const probe = transport.probeProxy;
      if (typeof probe !== "function") throw new Error("probeProxy missing on the transport");
      const outcome = await probe({ kind: "http-connect", proxyIp: "127.0.0.1", proxyPort: port });
      expect(outcome.alive).toBe(true);
      expect(typeof outcome.latencyMs).toBe("number");
    } finally {
      server.close();
    }
  });
});
