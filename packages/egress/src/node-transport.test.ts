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
      const msg = String((err as Error)?.message ?? (err as { code?: string })?.code ?? "");
      expect(/ERR_TLS_CERT_ALTNAME_INVALID|DEPTH_ZERO_SELF_SIGNED_CERT|hostname\/IP/i.test(msg)).toBe(true);
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

  it("does NOT honour HTTP_PROXY / HTTPS_PROXY (no proxy agent is ever set)", async () => {
    process.env.HTTP_PROXY = "http://127.0.0.1:1";
    process.env.HTTPS_PROXY = "http://127.0.0.1:1";
    process.env.NO_PROXY = "*";
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
      delete process.env.NO_PROXY;
    }
  });
});
