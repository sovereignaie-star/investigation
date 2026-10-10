import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { openVault } from "@ir/store";
import { vaultRouter } from "./vault";

const SECRET = "ipinfo_token_9c1e_never_returned";
const servers: Server[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function start(env: NodeJS.ProcessEnv = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "ir-srv-"));
  dirs.push(dir);
  const vault = openVault(path.join(dir, "vault.json"), { key: new Uint8Array(32).fill(3) });
  const upstream: { url: string; headers: Record<string, string> }[] = [];
  const fakeFetch = async (url: string, init?: RequestInit) => {
    upstream.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    if (url.includes("haveibeenpwned")) return new Response("", { status: 404 });
    return Response.json({ ip: "8.8.8.8", city: "Mountain View" });
  };
  const app = express();
  app.use(
    "/api",
    vaultRouter(() => vault, { fetch: fakeFetch, env }),
  );
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const all: string[] = [];
  const call = async (p: string, init: RequestInit = {}) => {
    const res = await fetch(base + p, init);
    const text = await res.text();
    all.push(text, JSON.stringify([...res.headers]));
    return { status: res.status, text };
  };
  return { call, upstream, all };
}
const put = (secret: unknown, extra: Record<string, string> = {}) => ({
  method: "PUT",
  headers: { "content-type": "application/json", ...extra },
  body: JSON.stringify({ secret }),
});

describe("vault routes (P1-015)", () => {
  it("stores, lists status, tests and deletes a key; no response ever contains the secret", async () => {
    const { call, upstream, all } = await start();
    expect((await call("/vault/ipinfo", put(SECRET))).status).toBe(200);
    const list = JSON.parse((await call("/vault")).text) as { entries: { name: string; configured: boolean }[] };
    expect(list.entries.find((e) => e.name === "ipinfo")).toMatchObject({ configured: true });
    expect(list.entries.find((e) => e.name === "shodan")).toMatchObject({ configured: false });
    expect(JSON.parse((await call("/vault/ipinfo/test", { method: "POST" })).text)).toMatchObject({ ok: true, tested: true });
    const ip = await call("/lookup/ip/8.8.8.8");
    expect(JSON.parse(ip.text)).toMatchObject({ city: "Mountain View" });
    // the key travels only server -> provider, in a header, never in the URL
    expect(upstream.every((u) => !u.url.includes(SECRET))).toBe(true);
    expect(upstream.some((u) => u.headers["authorization"] === `Bearer ${SECRET}`)).toBe(true);
    expect((await call("/vault/ipinfo", { method: "DELETE" })).status).toBe(204);
    expect((await call("/vault/ipinfo", { method: "DELETE" })).status).toBe(404);
    expect(all.join("\n")).not.toContain(SECRET);
  });

  it("rejects bad names, bodies and lookup inputs", async () => {
    const { call } = await start();
    expect((await call("/vault/..%2Fetc", put(SECRET))).status).toBe(400);
    expect((await call("/vault/ipinfo", put(42))).status).toBe(400);
    expect((await call("/lookup/ip/999.1.1.1")).status).toBe(400);
    expect((await call("/lookup/breaches/not-an-email")).status).toBe(400);
    expect((await call("/lookup/breaches/a@example.com")).status).toBe(409);
  });

  it("with IR_ADMIN_TOKEN, vault routes need the bearer token; proxied requests are refused without one", async () => {
    const s = await start({ IR_ADMIN_TOKEN: "admin-token-123" });
    expect((await s.call("/vault")).status).toBe(401);
    expect((await s.call("/vault", { headers: { authorization: "Bearer wrong-token-123" } })).status).toBe(401);
    expect((await s.call("/vault/hunter", put(SECRET, { authorization: "Bearer admin-token-123" }))).status).toBe(200);
    const open = await start();
    expect((await open.call("/vault", { headers: { "x-forwarded-for": "203.0.113.9" } })).status).toBe(403);
  });
});
