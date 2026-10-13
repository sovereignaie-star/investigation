import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Router } from "express";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { SESSION_COOKIE, CSRF_HEADER, createSessionStore, csrfTokenFor } from "./lib/session";

const servers: Server[] = [];
const restoreFns: Array<() => void> = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const r of restoreFns.splice(0)) r();
});

/** A minimal state-changing route so the CSRF/session layers can be exercised without the vault. */
function stateRouter() {
  const r = Router();
  r.post("/flip", (_req, res) => res.json({ ok: true }));
  r.get("/peek", (_req, res) => res.json({ ok: true }));
  return r;
}

async function start(opts: { env?: NodeJS.ProcessEnv; allowedOrigins?: Set<string>; apiRateLimit?: number } = {}) {
  const app = createApp(stateRouter(), {
    env: opts.env,
    allowedOrigins: opts.allowedOrigins,
    apiRateLimit: opts.apiRateLimit,
  });
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const call = async (p: string, init: RequestInit = {}) => {
    const res = await fetch(base + p, init);
    const text = await res.text();
    return { status: res.status, text, headers: res.headers };
  };
  return { call, base };
}

describe("P2-020 server hardening", () => {
  it("sets a local session cookie (HttpOnly, SameSite=Strict) on the first request", async () => {
    const { call } = await start();
    const res = await call("/peek");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=strict");
    expect(setCookie.toLowerCase()).toContain("path=/");
  });

  it("marks the session cookie Secure in production", async () => {
    const { call } = await start({ env: { NODE_ENV: "production" } });
    const res = await call("/peek");
    const setCookie = (res.headers.get("set-cookie") ?? "").toLowerCase();
    expect(setCookie).toContain("secure");
  });

  it("rejects a cross-origin state-changing request before the route runs (403)", async () => {
    const { call } = await start();
    const res = await call("/flip", {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.text)).toMatchObject({ error: "cross-origin state change blocked" });
  });

  it("allows a same-origin state-changing request with a bearer token", async () => {
    const { call, base } = await start();
    const origin = base.replace("/api", "");
    const res = await call("/flip", {
      method: "POST",
      headers: { origin, "content-type": "application/json", authorization: "Bearer some-token" },
      body: "{}",
    });
    expect(res.status).toBe(200);
  });

  it("allows an origin on the IR_ALLOWED_ORIGINS allowlist", async () => {
    const { call } = await start({ env: { IR_ALLOWED_ORIGINS: "https://app.example.com" } });
    const res = await call("/flip", {
      method: "POST",
      headers: { origin: "https://app.example.com", "content-type": "application/json", authorization: "Bearer some-token" },
      body: "{}",
    });
    expect(res.status).toBe(200);
  });

  it("requires the double-submit CSRF token for a browser request without a bearer token", async () => {
    const { call, base } = await start();
    const origin = base.replace("/api", "");
    // First request mints the session cookie; read it and echo it as the CSRF token.
    const first = await call("/peek");
    const setCookie = first.headers.get("set-cookie") ?? "";
    const sid = /ir_sid=([^;]+)/.exec(setCookie)?.[1] ?? "";
    expect(sid).toBeTruthy();

    const noToken = await call("/flip", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: "{}",
    });
    expect(noToken.status).toBe(403);
    expect(JSON.parse(noToken.text)).toMatchObject({ error: "CSRF token required" });

    const withToken = await call("/flip", {
      method: "POST",
      headers: { origin, "content-type": "application/json", [CSRF_HEADER]: sid, cookie: `ir_sid=${sid}` },
      body: "{}",
    });
    expect(withToken.status).toBe(200);
  });

  it("exempts bearer-authenticated requests from the CSRF token check", async () => {
    const { call, base } = await start();
    const origin = base.replace("/api", "");
    const res = await call("/flip", {
      method: "POST",
      headers: { origin, "content-type": "application/json", authorization: "Bearer some-token" },
      body: "{}",
    });
    expect(res.status).toBe(200);
  });

  it("does not require a CSRF token for requests without an Origin header (server-to-server)", async () => {
    const { call } = await start();
    const res = await call("/flip", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);
  });

  it("applies helmet security headers", async () => {
    const { call } = await start();
    const res = await call("/peek");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("referrer-policy")).toBeTruthy();
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("https://www.youtube.com");
    expect(csp).toContain("https://dns.google");
  });

  it("rejects an oversized body with 413", async () => {
    const { call } = await start();
    const big = JSON.stringify({ data: "x".repeat(9 * 1024) });
    const res = await call("/flip", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: big,
    });
    expect(res.status).toBe(413);
  });

  it("enforces the global API rate limit (429)", async () => {
    const { call } = await start({ apiRateLimit: 3 });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await call("/peek")).status);
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.slice(3)).toEqual([429, 429]);
  });

  it("session store expires ids after the TTL", () => {
    const store = createSessionStore(10);
    store.touch("a");
    expect(store.has("a")).toBe(true);
    const zero = createSessionStore(0);
    zero.touch("b");
    expect(zero.has("b")).toBe(false);
  });

  it("derives a stable per-session CSRF token from the boot secret", () => {
    const secret = Buffer.from("0123456789abcdef0123456789abcdef");
    const a = csrfTokenFor(secret, "sess-1");
    const b = csrfTokenFor(secret, "sess-1");
    const c = csrfTokenFor(secret, "sess-2");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
