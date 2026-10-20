// P3-014 red-first: the case export route must serve the format available in this
// phase — the projection snapshot JSON, the SAME shape `ir project --json` emits
// ({...projection, sha256}) — from a single projection snapshot of the case itself,
// never a rebuilt-from-the-browser copy. Unsupported formats are rejected explicitly
// (no silent fallback), locked cases fail closed with the J-17 message, and the export
// never mutates the case. The output is named what it is: a projection snapshot —
// not a full copy of the case and its evidence.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { casesRouter } from "./cases";
import { openCase, type Case } from "@ir/store";
import { manualClock, seededRandom, ulidFactory } from "@ir/core";
import { projectionHash } from "@ir/ledger/projections";

const clock = manualClock("2026-10-10T12:00:00.000Z");
const ulid = ulidFactory(clock, seededRandom(3));
const id = () => ulid();

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

async function start() {
  const root = mkdtempSync(path.join(tmpdir(), "ir-cases-export-"));
  roots.push(root);
  mkdirSync(root, { recursive: true });
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
    return { status: res.status, body, text, headers: res.headers };
  };
  return { call, root };
}

const CREATE = {
  title: "قضية اختبار التصدير",
  purpose: "تتبع كيانات عامة لاختبار تصدير لقطة الإسقاط",
  legalBasis: "due_diligence",
} as const;
const FAST = { memoryKiB: 256, passes: 1, parallelism: 1 } as const;

/**
 * A scenario with non-zero, deliberately UNEQUAL counts (a merge makes entities
 * differ from nodes) so a field swap or a rebuild from the wrong source cannot
 * pass by accident. Known values: 3 entities, 1 merge of 2 => 2 nodes, 1 claim =>
 * 1 edge, 2 observations, 1 evidence, 0 notes.
 */
function populate(c: Case): void {
  const ents = ["a@example.com", "example.com", "192.0.2.7"].map((v, i) => {
    const type = ["email", "domain", "ipv4"][i] as string;
    const e = { id: id(), type, canonicalKey: `${type}:${v}`, labels: { en: v, ar: `قيمة ${i}` }, props: {} };
    c.append("entity.added", e);
    return e.id;
  });
  const ev = c.addEvidence({
    bytes: new TextEncoder().encode('{"a":["192.0.2.7"]}'),
    mime: "application/json",
    request: { method: "DNS", url: "dns://example.com/A" },
    transformId: "tr-dns",
    version: "1",
  });
  const claim = { id: id(), subjectId: ents[1], predicate: "dns.a", objectId: ents[2], confidence: 0.9, explanation: "A record" };
  c.append("claim.added", claim);
  c.append("observation.added", {
    id: id(),
    claimId: claim.id,
    transformId: "tr-dns",
    evidenceId: ev.id,
    observedAt: "2026-10-10T12:00:01.000Z",
    kind: "positive",
  });
  c.append("observation.added", {
    id: id(),
    entityId: ents[0],
    transformId: "tr-breach",
    evidenceId: ev.id,
    observedAt: "2026-10-10T12:00:02.000Z",
    kind: "negative",
  });
  c.append("merge.decided", {
    id: id(),
    entityIds: [ents[0], ents[1]],
    survivorId: ents[1],
    reasons: ["same registrant per test"],
    decidedBy: "tester",
    decidedAt: "2026-10-10T12:00:03.000Z",
    reverted: false,
  });
}

describe("P3-014 case export (يصدر الصيغ المتاحة في المرحلة)", () => {
  it("serves the phase's format — the projection snapshot JSON, the exact `ir project --json` shape, as a download", async () => {
    const { call, root } = await start();
    const dir = path.join(root, "case-a");
    const c = openCase(dir, { actor: "analyst", create: { ...CREATE } });
    populate(c);
    c.close();

    // The truth the route must match: the case's own projection + its hash.
    const verify = openCase(dir, { readOnly: true, skipChainCheck: true, actor: "system" });
    const projection = verify.projection();
    verify.close();

    const fp = (await call("/cases", withAdmin())).body as { cases: Array<{ id: string }> };
    const caseId = fp.cases[0].id;
    const exported = await call(`/cases/${caseId}/export/projection`, withAdmin());
    expect(exported.status).toBe(200);
    // The acceptance criterion, literally: the exported file IS the projection snapshot.
    expect(exported.body).toEqual({ ...projection, sha256: projectionHash(projection) });
    // And the scenario's known values, so a rebuild from the wrong source cannot pass.
    expect((exported.body as { counts: Record<string, number> }).counts).toEqual({
      entities: 3,
      nodes: 2,
      claims: 1,
      edges: 1,
      observations: 2,
      evidence: 1,
      merges: 1,
      notes: 0,
    });
    // It is a download: JSON content type and a safe attachment filename carrying the case id.
    expect((exported.headers.get("content-type") ?? "").startsWith("application/json")).toBe(true);
    const disposition = exported.headers.get("content-disposition") ?? "";
    expect(disposition.startsWith("attachment;")).toBe(true);
    expect(disposition).toContain(caseId);
    expect(disposition).not.toContain("..");
  });

  it("an empty case exports a valid snapshot — its own seq and zeros, not a made-up one", async () => {
    const { call, root } = await start();
    const dir = path.join(root, "case-empty");
    const c = openCase(dir, { actor: "analyst", create: { ...CREATE } });
    c.close();

    const verify = openCase(dir, { readOnly: true, skipChainCheck: true, actor: "system" });
    const projection = verify.projection();
    verify.close();

    const fp = (await call("/cases", withAdmin())).body as { cases: Array<{ id: string }> };
    const exported = await call(`/cases/${fp.cases[0].id}/export/projection`, withAdmin());
    expect(exported.status).toBe(200);
    expect(exported.body).toEqual({ ...projection, sha256: projectionHash(projection) });
    expect((exported.body as { counts: Record<string, number> }).counts).toMatchObject({ entities: 0, nodes: 0, evidence: 0 });
  });

  it("an unsupported format is rejected explicitly — never a silent fallback to another format", async () => {
    const { call, root } = await start();
    const dir = path.join(root, "case-fmt");
    const c = openCase(dir, { actor: "analyst", create: { ...CREATE } });
    populate(c);
    c.close();
    const fp = (await call("/cases", withAdmin())).body as { cases: Array<{ id: string }> };
    const caseId = fp.cases[0].id;
    const bad = await call(`/cases/${caseId}/export/csv`, withAdmin());
    expect(bad.status).toBe(400);
    // The error names what IS supported, so the client can render an honest menu.
    expect(JSON.stringify(bad.body)).toContain("projection");
    // An invented format is likewise rejected — never a silent fallback.
    const invented = await call(`/cases/${caseId}/export/pdf`, withAdmin());
    expect(invented.status).toBe(400);
  });

  it("a locked case fails closed with the J-17 message — nothing is exported from it", async () => {
    const { call, root } = await start();
    const dir = path.join(root, "case-locked");
    const c = openCase(dir, { actor: "analyst", create: { ...CREATE }, passphrase: "long passphrase", kdf: FAST });
    populate(c);
    c.close();

    const fp = (await call("/cases", withAdmin())).body as { cases: Array<{ id: string; encrypted: boolean }> };
    const locked = fp.cases.find((x) => x.encrypted);
    expect(locked).toBeDefined();
    if (!locked) throw new Error("fixture error: no locked case");
    const exported = await call(`/cases/${locked.id}/export/projection`, withAdmin());
    expect(exported.status).toBe(403);
    expect(exported.body).toEqual({ error: "مقفلة — تتطلب فك التشفير" });
  });

  it("an unknown case id is 404 and a malformed id never reaches the file system", async () => {
    const { call } = await start();
    expect((await call("/cases/01AAAAAAAAAAAAAAAAAAAAAAAAAA/export/projection", withAdmin())).status).toBe(404);
    expect((await call("/cases/not-a-ulid/export/projection", withAdmin())).status).toBe(404);
  });

  it("sits behind the admin boundary (D-037): no token, no export", async () => {
    const { call, root } = await start();
    const dir = path.join(root, "case-auth");
    const c = openCase(dir, { actor: "analyst", create: { ...CREATE } });
    populate(c);
    c.close();
    const fp = (await call("/cases", withAdmin())).body as { cases: Array<{ id: string }> };
    const noAuth = await call(`/cases/${fp.cases[0].id}/export/projection`);
    expect(noAuth.status).toBe(401);
  });

  it("exporting never mutates the case — the projection hash before and after is identical", async () => {
    const { call, root } = await start();
    const dir = path.join(root, "case-immut");
    const c = openCase(dir, { actor: "analyst", create: { ...CREATE } });
    populate(c);
    c.close();

    const before = openCase(dir, { readOnly: true, skipChainCheck: true, actor: "system" });
    const hashBefore = projectionHash(before.projection());
    before.close();

    const fp = (await call("/cases", withAdmin())).body as { cases: Array<{ id: string }> };
    const exported = await call(`/cases/${fp.cases[0].id}/export/projection`, withAdmin());
    expect(exported.status).toBe(200);

    const after = openCase(dir, { readOnly: true, skipChainCheck: true, actor: "system" });
    const hashAfter = projectionHash(after.projection());
    after.close();
    expect(hashAfter).toBe(hashBefore);
  });
});
