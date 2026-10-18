/**
 * P2-028 (ADR-31) — the proxy-tunnel transport: HTTP CONNECT and SOCKS5, in-house, against local
 * fake proxy servers. The security invariants under test:
 *
 * 1. STRICT MODE (HTTP CONNECT + SOCKS5 non-Tor): the transport hands the proxy the PINNED TARGET
 *    IP — never the domain. The proxy is a byte relay and never resolves DNS.
 * 2. TOR EXCEPTION: the transport hands the DOMAIN (SOCKS5 ATYP 0x03) — the exit resolves it.
 * 3. TLS IS STILL VERIFIED over the tunnel: SNI = the URL hostname; a wrong-name certificate fails.
 * 4. FAIL-CLOSED: a refused/unauthenticated tunnel fails the request — there is NO direct fallback.
 * 5. SOCKS5 username/password (RFC 1929) and HTTP CONNECT Basic credentials are honoured.
 */
import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";

import * as https from "node:https";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createNodeTransport } from "./node-transport";
import type { EgressProxyTunnel } from "./egress";

function makeCert(host: string, alt: string): { cert: string; key: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p2028-tunnel-"));
  const crt = path.join(dir, "a.crt");
  const key = path.join(dir, "a.key");
  const r = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-subj",
      `/CN=${host}`,
      "-addext",
      `subjectAltName=${alt}`,
      "-keyout",
      key,
      "-out",
      crt,
      "-days",
      "2",
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0 || r.error) throw new Error(`openssl failed: ${r.stderr || r.error}`);
  const cert = fs.readFileSync(crt, "utf8");
  const keyPem = fs.readFileSync(key, "utf8");
  fs.rmSync(dir, { recursive: true, force: true });
  return { cert, key: keyPem };
}

const FIXTURE_HOST = "pinned-test.invalid"; // does NOT resolve — the fake proxy is the only path
const WRONG_HOST = "wrong-name.invalid";
const good = makeCert(FIXTURE_HOST, `DNS:${FIXTURE_HOST}`);
const wrong = makeCert(WRONG_HOST, `DNS:${WRONG_HOST}`);

const servers: Array<{ close: () => void }> = [];
afterEach(() => {
  while (servers.length) servers.pop()?.close();
});

/**
 * A local fake HTTP CONNECT proxy: records the CONNECT target line, then pipes the client
 * connection into the real local TLS server (so TLS + the HTTP response are genuine).
 */
function connectProxy(onConnect: (line: string, auth?: string) => void, refuse?: string): Promise<number> {
  return new Promise((resolve) => {
    const proxy = net.createServer((client) => {
      let buf = "";
      const onData = (c: Buffer) => {
        buf += c.toString("latin1");
        if (!buf.includes("\r\n\r\n")) return;
        client.off("data", onData);
        const head = buf.slice(0, buf.indexOf("\r\n\r\n"));
        const line = head.split("\r\n")[0];
        const authLine = head.split("\r\n").find((l) => l.toLowerCase().startsWith("proxy-authorization:"));
        onConnect(line, authLine);
        if (refuse) {
          client.end(`HTTP/1.1 ${refuse}\r\n\r\n`);
          return;
        }
        const tlsServer = https.createServer({ cert: good.cert, key: good.key }, (_req, res) => {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("through-connect");
        });
        servers.push({ close: () => tlsServer.close() });
        tlsServer.listen(0, "127.0.0.1", () => {
          const addr = tlsServer.address();
          const port = typeof addr === "object" && addr ? addr.port : 0;
          const upstream = net.connect(port, "127.0.0.1");
          client.write("HTTP/1.1 200 Connection established\r\n\r\n");
          client.pipe(upstream);
          upstream.pipe(client);
          upstream.on("error", () => client.destroy());
          client.on("error", () => upstream.destroy());
        });
      };
      client.on("data", onData);
    });
    proxy.listen(0, "127.0.0.1", () => {
      const addr = proxy.address();
      servers.push({ close: () => proxy.close() });
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
}

/**
 * A local fake SOCKS5 proxy: records the requested target (ATYP 0x01 IP or 0x03 domain),
 * optionally demands username/password auth, then pipes into the real local TLS server.
 */
function socksProxy(
  opts: {
    onTarget?: (atyp: number, target: string) => void;
    requireAuth?: boolean;
    rejectAuth?: boolean;
    failStatus?: number;
    cert?: { cert: string; key: string };
  } = {},
): Promise<number> {
  return new Promise((resolve) => {
    const proxy = net.createServer((client) => {
      const state = { step: 0 as 0 | 1 | 2, authed: !opts.requireAuth };
      const startRelay = () => {
        const tlsServer = https.createServer({ cert: opts.cert?.cert ?? good.cert, key: opts.cert?.key ?? good.key }, (_req, res) => {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("through-socks");
        });
        servers.push({ close: () => tlsServer.close() });
        tlsServer.listen(0, "127.0.0.1", () => {
          const addr = tlsServer.address();
          const port = typeof addr === "object" && addr ? addr.port : 0;
          const upstream = net.connect(port, "127.0.0.1");
          client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          client.pipe(upstream);
          upstream.pipe(client);
          upstream.on("error", () => client.destroy());
          client.on("error", () => upstream.destroy());
        });
      };
      const onData = (c: Buffer) => {
        if (state.step === 0) {
          state.step = 1;
          // greeting: [VER=5, NMETHODS, ...methods] — the server picks one (RFC 1928).
          const methods = c.subarray(2, 2 + c[1]);
          if (opts.requireAuth && methods.includes(0x02)) {
            state.authed = false;
            client.write(Buffer.from([0x05, 0x02]));
            return;
          }
          client.write(Buffer.from([0x05, 0x00]));
          return;
        }
        if (!state.authed) {
          // RFC 1929 username/password reply
          if (opts.rejectAuth) {
            client.end(Buffer.from([0x01, 0x01]));
            return;
          }
          state.authed = true;
          client.write(Buffer.from([0x01, 0x00]));
          return;
        }
        if (state.step === 1) {
          state.step = 2;
          const atyp = c[3];
          if (atyp === 0x01) {
            const ip = `${c[4]}.${c[5]}.${c[6]}.${c[7]}`;
            opts.onTarget?.(atyp, ip);
          } else if (atyp === 0x03) {
            const len = c[4];
            const name = c.subarray(5, 5 + len).toString("utf8");
            opts.onTarget?.(atyp, name);
          } else {
            opts.onTarget?.(atyp, "?");
          }
          if (opts.failStatus !== undefined) {
            client.write(Buffer.from([0x05, opts.failStatus, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
            client.end();
            return;
          }
          startRelay();
          return;
        }
      };
      client.on("data", onData);
    });
    proxy.listen(0, "127.0.0.1", () => {
      const addr = proxy.address();
      servers.push({ close: () => proxy.close() });
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
}

const BASE = { url: "", host: "", pinnedIp: "127.0.0.1", method: "GET" } as const;

function tunnelFetch(port: number, tunnel: EgressProxyTunnel, urlPort: number, ca = good.cert) {
  const t = createNodeTransport({ tlsOptions: { ca } });
  return t.fetch({
    ...BASE,
    url: `https://${FIXTURE_HOST}:${urlPort}/x`,
    host: `${FIXTURE_HOST}:${urlPort}`,
    proxy: tunnel,
  });
}

describe("P2-028 node-transport proxy tunnels (ADR-31)", () => {
  it("T-P2028-T01: HTTP CONNECT strict mode sends the PINNED TARGET IP — never the domain", async () => {
    let seen = "";
    const port = await connectProxy((line) => (seen = line));
    const r = await tunnelFetch(
      port,
      {
        kind: "http-connect",
        proxyIp: "127.0.0.1",
        proxyPort: port,
        target: { kind: "ip", ip: "127.0.0.1" },
      },
      port,
    );
    expect(r.status).toBe(200);
    expect(r.body).toBe("through-connect");
    expect(seen).toBe(`CONNECT 127.0.0.1:${port} HTTP/1.1`);
    // the DOMAIN never appears anywhere in the proxy-side handshake
    expect(seen.includes(FIXTURE_HOST)).toBe(false);
  });

  it("T-P2028-T02: HTTP CONNECT Basic credentials reach the proxy", async () => {
    let auth = "";
    const port = await connectProxy((_line, a) => (auth = a ?? ""));
    const r = await tunnelFetch(
      port,
      {
        kind: "http-connect",
        proxyIp: "127.0.0.1",
        proxyPort: port,
        credentials: { username: "u1", password: "p1" },
        target: { kind: "ip", ip: "127.0.0.1" },
      },
      port,
    );
    expect(r.status).toBe(200);
    expect(auth.startsWith("Proxy-Authorization: Basic ")).toBe(true);
  });

  it("T-P2028-T03: SOCKS5 strict mode sends the PINNED TARGET IP (ATYP 0x01)", async () => {
    let atyp = -1;
    let target = "";
    const port = await socksProxy({
      onTarget: (a, t) => {
        atyp = a;
        target = t;
      },
    });
    const r = await tunnelFetch(
      port,
      {
        kind: "socks5",
        proxyIp: "127.0.0.1",
        proxyPort: port,
        target: { kind: "ip", ip: "127.0.0.1" },
      },
      port,
    );
    expect(r.status).toBe(200);
    expect(r.body).toBe("through-socks");
    expect(atyp).toBe(0x01);
    expect(target).toBe("127.0.0.1");
  });

  it("T-P2028-T04: SOCKS5 Tor exception sends the DOMAIN (ATYP 0x03) — the exit resolves it", async () => {
    let atyp = -1;
    let target = "";
    const port = await socksProxy({
      onTarget: (a, t) => {
        atyp = a;
        target = t;
      },
    });
    const r = await tunnelFetch(
      port,
      {
        kind: "socks5",
        proxyIp: "127.0.0.1",
        proxyPort: port,
        target: { kind: "host", host: FIXTURE_HOST },
      },
      port,
    );
    expect(r.status).toBe(200);
    expect(r.body).toBe("through-socks");
    expect(atyp).toBe(0x03);
    expect(target).toBe(FIXTURE_HOST);
  });

  it("T-P2028-T05: SOCKS5 username/password (RFC 1929) is negotiated and accepted", async () => {
    let sawAuth = false;
    const port = await socksProxy({ requireAuth: true, onTarget: () => (sawAuth = true) });
    const r = await tunnelFetch(
      port,
      {
        kind: "socks5",
        proxyIp: "127.0.0.1",
        proxyPort: port,
        credentials: { username: "u9", password: "p9" },
        target: { kind: "ip", ip: "127.0.0.1" },
      },
      port,
    );
    expect(r.status).toBe(200);
    expect(sawAuth).toBe(true);
  });

  it("T-P2028-T06: fail-closed — a refused CONNECT fails the request (no direct fallback)", async () => {
    const port = await connectProxy(() => undefined, "403 Forbidden");
    await expect(
      tunnelFetch(
        port,
        {
          kind: "http-connect",
          proxyIp: "127.0.0.1",
          proxyPort: port,
          target: { kind: "ip", ip: "127.0.0.1" },
        },
        port,
      ),
    ).rejects.toThrowError(/proxy handshake/i);
  });

  it("T-P2028-T07: fail-closed — SOCKS5 rejects the connection (status 0x05) — no fallback", async () => {
    const port = await socksProxy({ failStatus: 0x05 });
    await expect(
      tunnelFetch(
        port,
        {
          kind: "socks5",
          proxyIp: "127.0.0.1",
          proxyPort: port,
          target: { kind: "ip", ip: "127.0.0.1" },
        },
        port,
      ),
    ).rejects.toThrowError(/0x5/i);
  });

  it("T-P2028-T08: fail-closed — SOCKS5 rejects the credentials — no fallback", async () => {
    const port = await socksProxy({ requireAuth: true, rejectAuth: true });
    await expect(
      tunnelFetch(
        port,
        {
          kind: "socks5",
          proxyIp: "127.0.0.1",
          proxyPort: port,
          credentials: { username: "u", password: "p" },
          target: { kind: "ip", ip: "127.0.0.1" },
        },
        port,
      ),
    ).rejects.toThrowError(/proxy auth/i);
  });

  it("T-P2028-T09: TLS is STILL verified over the tunnel — a wrong-name certificate fails", async () => {
    const port = await socksProxy({ cert: wrong });
    await expect(
      tunnelFetch(
        port,
        {
          kind: "socks5",
          proxyIp: "127.0.0.1",
          proxyPort: port,
          target: { kind: "host", host: FIXTURE_HOST },
        },
        port,
      ),
    ).rejects.toThrowError(/proxy handshake|wrong-name|hostname/i);
  });
});
