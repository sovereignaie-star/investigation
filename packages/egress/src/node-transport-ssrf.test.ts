/**
 * Transport-level SSRF cases (P2-003): T-SEC-SSRF-025 (environment proxy ignored), T-SEC-SSRF-026 (real TLS
 * certificate + hostname verification), T-SEC-SSRF-031 / 032 (body cap against the real wire framing) and
 * T-SEC-SSRF-033 (stacked / unsupported / bomb encodings).
 *
 * Everything runs against LOCAL servers bound to 127.0.0.1 with throw-away certificates generated in a temp dir.
 * No internet, no internal address other than the test's own loopback listeners, no metadata service.
 * Every case has a positive control (the legitimate path still works) and asserts what reached the server.
 */
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import * as tls from "node:tls";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants as zc, createGzip, gzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { createEgressGateway, EgressTransportError } from "./egress";
import { createNodeTransport, decodeBody, EgressSizeLimitError, MAX_ENCODING_LAYERS } from "./node-transport";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "egress-ssrf-"));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

function makeCert(name: string, san: string): { cert: string; key: string; certFile: string } {
  const dir = fs.mkdtempSync(path.join(TMP, "c-"));
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
      `/CN=${name}`,
      "-addext",
      `subjectAltName=${san}`,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`openssl failed: ${r.stderr}`);
  return { cert: fs.readFileSync(crt, "utf8"), key: fs.readFileSync(key, "utf8"), certFile: crt };
}

const HOST = "pinned-test.invalid"; // never resolves: only the pinned IP can reach the server
const good = makeCert(HOST, `DNS:${HOST}`);
const otherName = makeCert("other-name.invalid", "DNS:other-name.invalid");

interface Seen {
  requests: number;
  userAgents: string[];
}

const closers: Array<() => void> = [];
afterAll(() => {
  for (const c of closers.splice(0)) c();
});

async function tlsServer(
  cert: { cert: string; key: string },
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ port: number; seen: Seen }> {
  const seen: Seen = { requests: 0, userAgents: [] };
  const server = https.createServer({ cert: cert.cert, key: cert.key }, (req, res) => {
    seen.requests++;
    seen.userAgents.push(String(req.headers["user-agent"] ?? ""));
    handler(req, res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  closers.push(() => server.close());
  return { port: (server.address() as net.AddressInfo).port, seen };
}

/** A raw TLS server that writes exactly `raw` (status line, headers, body) so framing can lie. */
async function rawTlsServer(raw: () => Buffer): Promise<{ port: number }> {
  const server = tls.createServer({ cert: good.cert, key: good.key }, (sock) => {
    sock.once("data", () => {
      sock.end(raw());
    });
    sock.on("error", () => {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  closers.push(() => server.close());
  return { port: (server.address() as net.AddressInfo).port };
}

function fetchVia(t: ReturnType<typeof createNodeTransport>, port: number, headers?: Record<string, string>) {
  return t.fetch({ url: `https://${HOST}:${port}/x`, host: `${HOST}:${port}`, pinnedIp: "127.0.0.1", method: "GET", headers });
}

async function rejection(p: Promise<unknown>): Promise<Error & { code?: string; reason?: string }> {
  try {
    await p;
  } catch (e) {
    return e as Error & { code?: string; reason?: string };
  }
  throw new Error("expected a rejection, got a success");
}

describe("T-SEC-SSRF-025: an environment proxy is never used, even when Node is told to honour it", () => {
  it("with NODE_USE_ENV_PROXY=1 + HTTPS_PROXY set and NO NO_PROXY: the default agent goes to the proxy (control), the egress transport does not", async () => {
    const { port, seen } = await tlsServer(good, (_req, res) => res.end("direct"));
    // A counting proxy: records every CONNECT / request and refuses it.
    const proxyHits: string[] = [];
    const proxy = http.createServer((req, res) => {
      proxyHits.push(`${req.method} ${req.url}`);
      res.writeHead(502).end();
    });
    proxy.on("connect", (req, sock) => {
      proxyHits.push(`CONNECT ${req.url}`);
      sock.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    closers.push(() => proxy.close());
    const proxyUrl = `http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`;

    const loader = path.join(TMP, "loader.mjs");
    fs.writeFileSync(
      loader,
      `import { register } from "node:module";\nregister("data:text/javascript,export async function resolve(s,c,n){try{return await n(s,c)}catch(e){if(s.startsWith('.')&&!/\\\\.[cm]?[jt]s$/.test(s))return n(s+'.ts',c);throw e}}");\n`,
    );
    const child = path.join(TMP, "child.mjs");
    fs.writeFileSync(
      child,
      `import * as https from "node:https";
import * as fs from "node:fs";
const { createNodeTransport } = await import(${JSON.stringify(path.join(HERE, "node-transport.ts"))});
const ca = fs.readFileSync(process.env.CA_FILE, "utf8");
const url = "https://${HOST}:" + process.env.PORT + "/x";
const out = {};
// CONTROL: the default global agent with the same CA and the pinned name. If Node honours the proxy env, this
// request goes to the proxy (and fails there) instead of the server.
out.control = await new Promise((resolve) => {
  const r = https.get(url, { ca, lookup: (_h, o, cb) => (o && o.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4)) }, (res) => {
    let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve({ status: res.statusCode, body: b }));
  });
  r.on("error", (e) => resolve({ error: String(e.code || e.message) }));
});
const t = createNodeTransport({ tlsOptions: { ca } });
try {
  const r = await t.fetch({ url, host: "${HOST}:" + process.env.PORT, pinnedIp: "127.0.0.1", method: "GET" });
  out.egress = { status: r.status, body: r.body };
} catch (e) { out.egress = { error: String(e.code || e.message) }; }
process.stdout.write(JSON.stringify(out));
`,
    );
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      NODE_USE_ENV_PROXY: "1",
      HTTPS_PROXY: proxyUrl,
      HTTP_PROXY: proxyUrl,
      https_proxy: proxyUrl,
      http_proxy: proxyUrl,
      CA_FILE: good.certFile,
      PORT: String(port),
    };
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const p = spawn(process.execPath, ["--experimental-transform-types", "--no-warnings", "--import", loader, child], { env });
      let stdout = "";
      let stderr = "";
      p.stdout.on("data", (d) => (stdout += d));
      p.stderr.on("data", (d) => (stderr += d));
      p.on("close", (code) => resolve({ code, stdout, stderr }));
    });
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const out = JSON.parse(result.stdout) as { control: { error?: string; status?: number }; egress: { status?: number; body?: string } };
    // Control: the environment really activates the proxy in this Node (otherwise the test proves nothing).
    expect(out.control.status).not.toBe(200);
    expect(proxyHits.some((h) => h.startsWith(`CONNECT ${HOST}:${port}`))).toBe(true);
    // The egress transport went DIRECTLY to the pinned IP and the proxy saw exactly one hit (the control's).
    expect(out.egress).toEqual({ status: 200, body: "direct" });
    expect(proxyHits).toHaveLength(1);
    expect(seen.requests).toBe(1);
  }, 20_000);
});

describe("T-SEC-SSRF-026: real TLS — certificate chain and hostname are verified against the URL host, not the pinned IP", () => {
  it("control: a certificate for the URL host from a trusted CA connects", async () => {
    const { port, seen } = await tlsServer(good, (_req, res) => res.end("ok"));
    const r = await fetchVia(createNodeTransport({ tlsOptions: { ca: good.cert } }), port);
    expect(r).toMatchObject({ status: 200, body: "ok" });
    expect(seen.requests).toBe(1);
  });

  it("a trusted certificate for ANOTHER name is refused with ERR_TLS_CERT_ALTNAME_INVALID; the server never sees a request", async () => {
    const { port, seen } = await tlsServer(otherName, (_req, res) => res.end("must-not-reach"));
    const err = await rejection(fetchVia(createNodeTransport({ tlsOptions: { ca: otherName.cert } }), port));
    expect(err.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
    expect(seen.requests).toBe(0);
  });

  it("a certificate for the right name from an UNTRUSTED issuer is refused (self-signed, no CA override)", async () => {
    const { port, seen } = await tlsServer(good, (_req, res) => res.end("must-not-reach"));
    const err = await rejection(fetchVia(createNodeTransport(), port));
    expect(err.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(seen.requests).toBe(0);
  });

  it("a certificate whose SAN is the pinned IP (not the URL host) is refused: verification uses the URL host", async () => {
    const ipCert = makeCert("127.0.0.1", "IP:127.0.0.1");
    const { port, seen } = await tlsServer(ipCert, (_req, res) => res.end("must-not-reach"));
    const err = await rejection(fetchVia(createNodeTransport({ tlsOptions: { ca: ipCert.cert } }), port));
    expect(err.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
    expect(seen.requests).toBe(0);
  });

  it("verification cannot be switched off through tlsOptions (rejectUnauthorized / checkServerIdentity are not forwarded)", async () => {
    const { port, seen } = await tlsServer(otherName, (_req, res) => res.end("must-not-reach"));
    const hostile = { ca: otherName.cert, rejectUnauthorized: false, checkServerIdentity: () => undefined } as unknown as { ca: string };
    const err = await rejection(fetchVia(createNodeTransport({ tlsOptions: hostile }), port));
    expect(err.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
    expect(seen.requests).toBe(0);
  });

  it("negative control: the same server and the same trusted CA ARE reachable under the certificate's own name (so the refusals above come from hostname verification, with verification still on)", async () => {
    const { port, seen } = await tlsServer(otherName, (_req, res) => res.end("reached"));
    const r = await createNodeTransport({ tlsOptions: { ca: otherName.cert } }).fetch({
      url: `https://other-name.invalid:${port}/x`,
      host: `other-name.invalid:${port}`,
      pinnedIp: "127.0.0.1",
      method: "GET",
    });
    expect(r).toMatchObject({ status: 200, body: "reached" });
    expect(seen.requests).toBe(1);
  });

  it("sends an explicit User-Agent that carries no case data (ADR-08)", async () => {
    const { port, seen } = await tlsServer(good, (_req, res) => res.end("ok"));
    await fetchVia(createNodeTransport({ tlsOptions: { ca: good.cert } }), port);
    expect(seen.userAgents).toEqual(["InvestigationRoom-egress/1"]);
  });
});

describe("T-SEC-SSRF-031: the wire cap holds for chunked bodies without Content-Length", () => {
  const CAP = 64 * 1024;
  it("control: a chunked body of exactly the cap is accepted", async () => {
    const { port } = await tlsServer(good, (_req, res) => {
      res.writeHead(200, { "transfer-encoding": "chunked" });
      for (let i = 0; i < 16; i++) res.write(Buffer.alloc(CAP / 16, 0x61));
      res.end();
    });
    const r = await fetchVia(createNodeTransport({ tlsOptions: { ca: good.cert }, maxBodyBytes: CAP }), port);
    expect(r.body?.length).toBe(CAP);
  });

  it("one byte over the cap is refused with reason size_limit (no truncated success)", async () => {
    const { port } = await tlsServer(good, (_req, res) => {
      res.writeHead(200, { "transfer-encoding": "chunked" });
      for (let i = 0; i < 16; i++) res.write(Buffer.alloc(CAP / 16, 0x61));
      res.end(Buffer.from("b"));
    });
    const err = await rejection(fetchVia(createNodeTransport({ tlsOptions: { ca: good.cert }, maxBodyBytes: CAP }), port));
    expect(err).toBeInstanceOf(EgressSizeLimitError);
    expect(err).toBeInstanceOf(EgressTransportError);
    expect(err.reason).toBe("size_limit");
  });
});

describe("T-SEC-SSRF-032: a lying Content-Length never widens what is read", () => {
  it("Content-Length smaller than the bytes sent: the extra bytes are never delivered (the HTTP parser refuses the response)", async () => {
    const big = Buffer.alloc(1024 * 1024, 0x62);
    const { port } = await rawTlsServer(() =>
      Buffer.concat([Buffer.from("HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\n"), Buffer.from("hello"), big]),
    );
    const err = await rejection(fetchVia(createNodeTransport({ tlsOptions: { ca: good.cert }, maxBodyBytes: 1024 }), port));
    // llhttp: "Data after `Connection: close`" — the response is refused instead of being read past its framing.
    expect(String(err.code)).toMatch(/^HPE_/);
  });

  it("control: a truthful Content-Length is read exactly", async () => {
    const { port } = await rawTlsServer(() => Buffer.from("HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello"));
    const r = await fetchVia(createNodeTransport({ tlsOptions: { ca: good.cert }, maxBodyBytes: 1024 }), port);
    expect(r.body).toBe("hello");
    expect(r.contentLength).toBe(5);
  });

  it("Content-Length larger than the bytes sent (early close) is an error, not a short success", async () => {
    const { port } = await rawTlsServer(() => Buffer.from("HTTP/1.1 200 OK\r\nContent-Length: 1000\r\nConnection: close\r\n\r\nshort"));
    await rejection(fetchVia(createNodeTransport({ tlsOptions: { ca: good.cert } }), port));
  });

  it("gateway: a declared length under the cap with a real body over it is refused (cap on actual bytes)", async () => {
    let calls = 0;
    const g = createEgressGateway({
      resolver: { resolve: async () => ["93.184.216.34"] },
      transport: {
        fetch: async () => {
          calls++;
          return { status: 200, body: "x".repeat(2048), contentLength: 10 };
        },
      },
      limits: { maxSizeBytes: 1024 },
    });
    const r = await g.request({
      caseId: "c",
      purposeRef: "p",
      transform: "t@1",
      url: "https://example.com/",
      method: "GET",
      sends: ["domain"],
      sensitivity: "normal",
    });
    expect(r).toMatchObject({ ok: false, reason: "size_limit" });
    expect(calls).toBe(1);
  });
});

describe("T-SEC-SSRF-033: stacked, unsupported and bomb encodings", () => {
  const payload = Buffer.from("layered-payload");

  it("control: gzip then br (Content-Encoding: gzip, br) decodes in reverse order", () => {
    const wire = brotliCompressSync(gzipSync(payload));
    expect(decodeBody(wire, "gzip, br", 1024).toString()).toBe("layered-payload");
  });

  it(`more than ${MAX_ENCODING_LAYERS} layers is refused with reason content_encoding`, () => {
    const wire = gzipSync(gzipSync(gzipSync(payload)));
    let err: unknown;
    try {
      decodeBody(wire, "gzip, gzip, gzip", 1024);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(EgressTransportError);
    expect((err as EgressTransportError).reason).toBe("content_encoding");
  });

  for (const coding of ["zstd", "compress", "gzip, unknown-x"]) {
    it(`an unsupported coding (${coding}) is refused with reason content_encoding`, () => {
      expect(() => decodeBody(gzipSync(payload), coding, 1024)).toThrow(EgressTransportError);
      try {
        decodeBody(gzipSync(payload), coding, 1024);
      } catch (e) {
        expect((e as EgressTransportError).reason).toBe("content_encoding");
      }
    });
  }

  it("a corrupt gzip body is refused with reason content_encoding (not passed through raw)", () => {
    try {
      decodeBody(Buffer.from("not gzip at all"), "gzip", 1024);
      throw new Error("expected refusal");
    } catch (e) {
      expect((e as EgressTransportError).reason).toBe("content_encoding");
    }
  });

  it("a 1 GiB gzip bomb is stopped at the decoded cap while decoding (memory stays bounded)", async () => {
    // Build the bomb by streaming zeros through gzip: ~1 MiB on the wire, 1 GiB decoded. Never allocated whole.
    const gz = createGzip({ level: zc.Z_BEST_COMPRESSION });
    const parts: Buffer[] = [];
    gz.on("data", (c: Buffer) => parts.push(c));
    const done = new Promise((r) => gz.on("end", r));
    const zeros = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < 1024; i++) {
      if (!gz.write(zeros)) await new Promise((r) => gz.once("drain", r));
    }
    gz.end();
    await done;
    const bomb = Buffer.concat(parts);
    expect(bomb.length).toBeLessThan(2 * 1024 * 1024);
    const before = process.memoryUsage().rss;
    let err: unknown;
    try {
      decodeBody(bomb, "gzip", 1024 * 1024);
    } catch (e) {
      err = e;
    }
    const grew = process.memoryUsage().rss - before;
    expect(err).toBeInstanceOf(EgressSizeLimitError);
    expect((err as EgressSizeLimitError).reason).toBe("size_limit");
    // Full inflation would need 1 GiB; bounded decoding stays far below that.
    expect(grew).toBeLessThan(256 * 1024 * 1024);
  }, 60_000);

  it("a stacked bomb over the real wire (gzip, gzip) is refused with size_limit", async () => {
    const inner = gzipSync(Buffer.alloc(8 * 1024 * 1024));
    const wire = gzipSync(inner);
    const { port } = await tlsServer(good, (_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip, gzip" });
      res.end(wire);
    });
    const err = await rejection(fetchVia(createNodeTransport({ tlsOptions: { ca: good.cert }, maxDecodedBytes: 1024 * 1024 }), port));
    expect(err).toBeInstanceOf(EgressSizeLimitError);
  });

  it("control: a stacked encoding under the cap over the real wire decodes", async () => {
    const { port } = await tlsServer(good, (_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip, br" });
      res.end(brotliCompressSync(gzipSync(payload)));
    });
    const r = await fetchVia(createNodeTransport({ tlsOptions: { ca: good.cert } }), port);
    expect(r.body).toBe("layered-payload");
  });
});
