// P3-003 (طلب أ — العقود والخلفية): REST contracts for the case lifecycle, per the owner
// decisions of 2026-10-19 (J-16/J-17/J-18): create with purpose (E-01), list with state
// filter, locked cases show an identifier only, archive = hide + write-block, unarchive
// requires PurposeConfirmation (E-02 pattern), no delete ever.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { casesRouter } from "./cases";

const ADMIN_TOKEN = "admin-token-123";
const ENABLED = { IR_ADMIN_TOKEN: ADMIN_TOKEN };
const servers: Server[] = [];
const roots: string[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function withAdmin(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${ADMIN_TOKEN}`);
  return { ...init, headers };
}

// L-53 (P4-007): the per-route cases limiter must honor IR_CASES_RATE_LIMIT. What the
// CI failure artifact PROVED is that case-open received HTTP 429; which limiter
// (this one or the global one) rejected it is not conclusively distinguishable.
// Production keeps the default; the override makes the ceiling a deployment decision.
it("the cases limiter honors IR_CASES_RATE_LIMIT (env-configurable, default unchanged)", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "ir-cases-rate-"));
  roots.push(root);
  const app = createApp(casesRouter(() => root, { env: { ...ENABLED, IR_CASES_RATE_LIMIT: "2" } }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const statuses: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    statuses.push((await fetch(`${base}/cases`, withAdmin())).status);
  }
  expect(statuses.slice(0, 2)).toEqual([200, 200]);
  expect(statuses.slice(2)).toEqual([429, 429]);
});

// L-53 (P4-007): the default ceiling is UNCHANGED by the override capability — 60/min
// in a fixed window: the first 60 pass, the 61st is rejected. This guards the production
// default against accidental drift while the override exists.
it("the cases limiter default stays 60/min when no override is set", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "ir-cases-rate-default-"));
  roots.push(root);
  const app = createApp(casesRouter(() => root, { env: ENABLED }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const statuses: number[] = [];
  for (let i = 0; i < 61; i += 1) {
    statuses.push((await fetch(`${base}/cases`, withAdmin())).status);
  }
  expect(statuses.slice(0, 60)).not.toContain(429);
  expect(statuses[60]).toBe(429);
});

async function start() {
  const root = mkdtempSync(path.join(tmpdir(), "ir-cases-"));
  roots.push(root);
  const app = createApp(casesRouter(() => root, { env: ENABLED }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const call = async (p: string, init: RequestInit = {}) => {
    const res = await fetch(base + p, init);
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep text */
    }
    return { status: res.status, body, text };
  };
  return { call, root };
}

const CREATE = {
  title: "شبكة تجارة إلكترونية مشبوهة",
  purpose: "تتبع شبكة شركات وأشخاص عامين لتحقيق صحفي استقصائي موثق الغرض",
  legalBasis: "journalism",
};

function json(init: RequestInit, body: unknown): RequestInit {
  return { ...init, method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

describe("P3-003 cases API (UC-01, J-16/J-17/J-18)", () => {
  it("creates a case with a stated purpose (UC-01) and names its directory by the case id", async () => {
    const { call, root } = await start();
    const res = await call("/cases", withAdmin(json({}, CREATE)));
    expect(res.status).toBe(201);
    const created = res.body as { id: string; title: string; purpose: string; archivedAt: string | null };
    expect(created.title).toBe(CREATE.title);
    expect(created.purpose).toBe(CREATE.purpose);
    expect(created.archivedAt).toBeNull();
    expect(readdirSync(root)).toContain(created.id);
  });

  it("E-01 fail-closed: no purpose, no case (400) and no directory left behind", async () => {
    const { call, root } = await start();
    const res = await call("/cases", withAdmin(json({}, { ...CREATE, purpose: "قصير" })));
    expect(res.status).toBe(400);
    expect(readdirSync(root).filter((d) => !d.startsWith("."))).toHaveLength(0);
  });

  it("admin boundary: no token, no case routes (401)", async () => {
    const { call } = await start();
    const res = await call("/cases", json({}, CREATE));
    expect(res.status).toBe(401);
  });

  it("lists cases; an encrypted case locked without its passphrase shows an identifier only (J-17)", async () => {
    const { call } = await start();
    await call("/cases", withAdmin(json({}, CREATE)));
    const locked = await call("/cases", withAdmin(json({}, { ...CREATE, title: "قضية مشفرة", passphrase: "سر-قوي-جدا" })));
    expect(locked.status).toBe(201);

    const list = await call("/cases", withAdmin());
    expect(list.status).toBe(200);
    const cases = (list.body as { cases: unknown[] }).cases;
    expect(cases).toHaveLength(2);

    const lockedSummary = cases.find((c) => (c as { encrypted: boolean }).encrypted) as {
      id: string;
      status: string;
      title: string | null;
      purpose: string | null;
      createdAt: string;
      lastActivityAt: string | null;
    };
    expect(lockedSummary.status).toBe("locked-encrypted");
    expect(lockedSummary.title).toBeNull();
    expect(lockedSummary.purpose).toBeNull();
    expect(lockedSummary.createdAt).toBeTruthy();
    expect(lockedSummary.lastActivityAt).toBeTruthy();
  });

  it("detail: full record when readable; an explicit locked message with no content when locked", async () => {
    const { call } = await start();
    const created = (await (await call("/cases", withAdmin(json({}, CREATE)))).body) as { id: string };
    const detail = await call(`/cases/${created.id}`, withAdmin());
    expect(detail.status).toBe(200);
    expect((detail.body as { title: string }).title).toBe(CREATE.title);

    const enc = (await (
      await call("/cases", withAdmin(json({}, { ...CREATE, passphrase: "سر-قوي-جدا" })))
    ).body) as {
      id: string;
    };
    const lockedDetail = await call(`/cases/${enc.id}`, withAdmin());
    expect(lockedDetail.status).toBe(200);
    const body = lockedDetail.body as { status: string; title: string | null; message: string };
    expect(body.status).toBe("locked-encrypted");
    expect(body.title).toBeNull();
    expect(body.message).toContain("فك التشفير");
  });

  it("unknown case id: 404", async () => {
    const { call } = await start();
    const res = await call("/cases/01NOPE", withAdmin());
    expect(res.status).toBe(404);
  });

  it("CodeQL taint fix: a non-ULID id (traversal, dot-dot, encoded) never becomes a path — 404", async () => {
    const { call, root } = await start();
    for (const id of ["..%2F..%2Fetc", "%2e%2e%2f", "a".repeat(26), "01M58XF9ZKJT50S8E8JYXF6P3X", "01M58XF9ZKJT50S8E8JYXF6P3"]) {
      const res = await call(`/cases/${id}`, withAdmin());
      expect(res.status, id).toBe(404);
    }
    expect(readdirSync(root)).toHaveLength(0); // nothing was created or read outside the root
  });

  it("archive hides by default and write-blocks (J-16); includeArchived=true lists it", async () => {
    const { call } = await start();
    const created = (await (await call("/cases", withAdmin(json({}, CREATE)))).body) as { id: string };
    const patch = await call(
      `/cases/${created.id}`,
      withAdmin({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "archive", reason: "اكتمل التحقيق الصحفي" }),
      }),
    );
    expect(patch.status).toBe(200);
    expect((patch.body as { archivedAt: string }).archivedAt).toBeTruthy();

    const active = (await (await call("/cases", withAdmin())).body) as { cases: unknown[] };
    expect(active.cases).toHaveLength(0);
    const all = (await (
      await call("/cases?includeArchived=true", withAdmin())
    ).body) as {
      cases: Array<{ id: string; status: string }>;
    };
    expect(all.cases).toHaveLength(1);
    expect(all.cases[0].status).toBe("archived");

    // write-block: archiving an archived case is a conflict, not a second archive
    const again = await call(
      `/cases/${created.id}`,
      withAdmin({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "archive", reason: "مرة أخرى" }),
      }),
    );
    expect(again.status).toBe(409);
  });

  it("unarchive requires an explicit PurposeConfirmation (E-02 pattern); with one, the case is active again", async () => {
    const { call } = await start();
    const created = (await (await call("/cases", withAdmin(json({}, CREATE)))).body) as { id: string };
    await call(
      `/cases/${created.id}`,
      withAdmin({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "archive", reason: "اكتمل" }),
      }),
    );
    const noConfirm = await call(
      `/cases/${created.id}`,
      withAdmin({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "unarchive", reason: "سبب عام" }),
      }),
    );
    expect(noConfirm.status).toBe(422);

    const confirmed = await call(
      `/cases/${created.id}`,
      withAdmin({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "unarchive",
          reason: "معلومات جديدة وصلت",
          purposeConfirmation: "إعادة فتح قضية نشطة لغرض التحقيق الصحفي الموثق نفسه",
        }),
      }),
    );
    expect(confirmed.status).toBe(200);
    expect((confirmed.body as { archivedAt: string | null }).archivedAt).toBeNull();
    const active = (await (await call("/cases", withAdmin())).body) as { cases: unknown[] };
    expect(active.cases).toHaveLength(1);
  });

  it("unarchiving an active case is a conflict (409)", async () => {
    const { call } = await start();
    const created = (await (await call("/cases", withAdmin(json({}, CREATE)))).body) as { id: string };
    const res = await call(
      `/cases/${created.id}`,
      withAdmin({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "unarchive", reason: "غير مؤرشفة أصلاً", purposeConfirmation: "غرض موثق للاختبار" }),
      }),
    );
    expect(res.status).toBe(409);
  });

  it("no delete, ever: DELETE is not routed and the case survives (J-16)", async () => {
    const { call } = await start();
    const created = (await (await call("/cases", withAdmin(json({}, CREATE)))).body) as { id: string };
    const res = await call(`/cases/${created.id}`, withAdmin({ method: "DELETE" }));
    expect(res.status).toBe(404);
    const detail = await call(`/cases/${created.id}`, withAdmin());
    expect(detail.status).toBe(200);
  });
});

describe("P3-020: an empty cases root (fresh deployment)", () => {
  it("lists an honest empty case list, never a 500 — the root dir may not exist yet", async () => {
    // A fresh deployment's data root has no cases/ directory until the first case is
    // created; the list must answer 200 {cases: []}, not an ENOENT 500 (the cold
    // journey of UC-01 starts here).
    const parent = mkdtempSync(path.join(tmpdir(), "ir-cases-empty-"));
    roots.push(parent);
    const app = createApp(casesRouter(() => path.join(parent, "cases"), { env: ENABLED }));
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const res = await fetch(`${base}/cases`, withAdmin());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cases: [] });
  });
});
