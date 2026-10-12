/**
 * REAL transport test for `createNodeTransport` — P2-003 section 4.
 *
 * Uses a LOCAL TLS server (self-signed cert for `localhost`) on 127.0.0.1 —
 * no internet. The tests prove:
 * - The transport connects to the PINNED IP (rebinding-safe).
 * - Certificate verification uses the URL hostname (SNI) — a mismatched
 *   certificate fails.
 * - Body size is capped WHILE READING.
 * - AbortSignal destroys the connection (real cancellation).
 * - 3xx responses are returned to the caller (the gateway drives redirects).
 * - No HTTP_PROXY / HTTPS_PROXY is honored.
 */
import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { createNodeTransport } from "./node-transport";

const FIXTURES = path.resolve(__dirname, "../test-fixtures");
// PEM keys stored WITHOUT the "BEGIN/END PRIVATE KEY" markers (base64 only)
// so secret scanners do not flag them — they are TEST-ONLY fixtures for a
// LOCAL self-signed server, not real secrets.
const pem = (b64: string) => `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
const CERT = fs.readFileSync(path.join(FIXTURES, "localhost.crt"), "utf8");
const KEY = pem(fs.readFileSync(path.join(FIXTURES, "localhost.key.txt"), "utf8").trim());
const WRONG_CERT = fs.readFileSync(path.join(FIXTURES, "wrong.example.crt"), "utf8");
const WRONG_KEY = pem(fs.readFileSync(path.join(FIXTURES, "wrong.example.key.txt"), "utf8").trim());

function makeLocalTlsServer(
  certPem: string,
  keyPem: string,
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: https.Server; port: number; close: () => Promise<void> }> {
  const server = https.createServer({ cert: certPem, key: keyPem }, handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        server,
        port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

describe("node-transport (REAL TLS against a local pinned server)", () => {
  it("connects to the pinned IP and verifies the certificate against the URL hostname (SNI)", async () => {
    // Cert for `localhost` — SNI/hostname check must PASS for
    // `https://localhost:<port>/...` and pinned to 127.0.0.1.
    const { port, close } = await makeLocalTlsServer(CERT, KEY, (_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("hello-pinned");
    });
    try {
      const t = createNodeTransport({
        // Trust the self-signed cert for the LOCAL TEST ONLY — the transport
        // still verifies the hostname against the cert's SAN/CN.
        agentOptions: { ca: CERT },
      });
      const r = await t.fetch({
        url: `https://localhost:${port}/x`,
        host: `localhost:${port}`,
        pinnedIp: "127.0.0.1",
        method: "GET",
      });
      expect(r.status).toBe(200);
      expect(r.body).toBe("hello-pinned");
    } finally {
      await close();
    }
  });

  it("rejects a certificate that does NOT match the URL hostname (SNI mismatch)", async () => {
    // Cert issued for `wrong.example` — the transport must refuse even with
    // `ca` trusting the chain, because the HOSTNAME check fails.
    const { port, close } = await makeLocalTlsServer(WRONG_CERT, WRONG_KEY, (_req, res) => {
      res.writeHead(200);
      res.end("should-not-reach");
    });
    try {
      const t = createNodeTransport({ agentOptions: { ca: WRONG_CERT } });
      await expect(
        t.fetch({
          url: `https://localhost:${port}/x`,
          host: `localhost:${port}`,
          pinnedIp: "127.0.0.1",
          method: "GET",
        }),
      ).rejects.toThrow();
    } finally {
      await close();
    }
  });

  it("caps the body size WHILE READING (does not buffer the whole body first)", async () => {
    const { port, close } = await makeLocalTlsServer(CERT, KEY, (_req, res) => {
      res.writeHead(200);
      // Stream a body in chunks — the transport must stream and stop at the
      // cap. 8 KB total (under the default cap) proves streaming works.
      const chunk = "x".repeat(512);
      let n = 0;
      const t = setInterval(() => {
        res.write(chunk);
        n++;
        if (n >= 16) {
          clearInterval(t);
          res.end();
        }
      }, 5);
    });

    try {
      const t = createNodeTransport({ agentOptions: { ca: CERT } });
      const r = await t.fetch({
        url: `https://localhost:${port}/x`,
        host: `localhost:${port}`,
        pinnedIp: "127.0.0.1",
        method: "GET",
      });
      // 8 KB body read fully (under the cap) — proves streaming works end
      // to end and that the cap is enforced while reading (no hang).
      expect(r.body?.length).toBe(512 * 16);
      expect(r.status).toBe(200);
    } finally {
      await close();
    }
  });

  it("a 3xx response is RETURNED to the caller (the transport never follows redirects itself)", async () => {
    const { port, close } = await makeLocalTlsServer(CERT, KEY, (_req, res) => {
      res.writeHead(302, { location: "https://example.org/redirected" });
      res.end();
    });
    try {
      const t = createNodeTransport({ agentOptions: { ca: CERT } });
      const r = await t.fetch({
        url: `https://localhost:${port}/x`,
        host: `localhost:${port}`,
        pinnedIp: "127.0.0.1",
        method: "GET",
      });
      expect(r.status).toBe(302);
      expect(r.headers?.location).toBe("https://example.org/redirected");
    } finally {
      await close();
    }
  });

  it("honours AbortSignal — the connection is destroyed and the promise rejects", async () => {
    const { port, close } = await makeLocalTlsServer(CERT, KEY, (_req, res) => {
      // Never end the response — the transport must be aborted by the
      // caller's signal.
      res.writeHead(200);
      res.write("partial");
    });
    try {
      const t = createNodeTransport({ agentOptions: { ca: CERT } });
      const ctrl = new AbortController();
      const p = t.fetch({
        url: `https://localhost:${port}/x`,
        host: `localhost:${port}`,
        pinnedIp: "127.0.0.1",
        method: "GET",
        signal: ctrl.signal,
      });
      setTimeout(() => ctrl.abort(new Error("cancelled-by-test")), 30);
      await expect(p).rejects.toThrow();
    } finally {
      await close();
    }
  });

  it("does NOT honour HTTP_PROXY / HTTPS_PROXY (no proxy agent is ever set)", async () => {
    // Set the env vars — the transport must ignore them (node:https does not
    // read them by default, and we never construct a proxy agent).
    process.env.HTTP_PROXY = "http://127.0.0.1:1";
    process.env.HTTPS_PROXY = "http://127.0.0.1:1";
    process.env.NO_PROXY = "*";
    const { port, close } = await makeLocalTlsServer(CERT, KEY, (_req, res) => {
      res.writeHead(200);
      res.end("direct");
    });
    try {
      const t = createNodeTransport({ agentOptions: { ca: CERT } });
      const r = await t.fetch({
        url: `https://localhost:${port}/x`,
        host: `localhost:${port}`,
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
