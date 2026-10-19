// P3-012 red-first: the case stats route must serve the case's own projection
// counts — the acceptance criterion «أرقام تطابق الإسقاط» — from a single
// projection snapshot, never a parallel recount. Locked cases fail closed with
// the J-17 message (never zeros that look like real statistics), unknown or
// malformed ids are 404, and the route sits behind the same admin boundary as
// every case route (D-037).
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
  const root = mkdtempSync(path.join(tmpdir(), "ir-cases-stats-"));
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
    return { status: res.status, body, text };
  };
  return { call, root };
}

const CREATE = {
  title: "قضية اختبار الإحصاءات",
  purpose: "تتبع كيانات عامة لاختبار إحصاءات تطابق الإسقاط",
  legalBasis: "due_diligence",
} as const;
const FAST = { memoryKiB: 256, passes: 1, parallelism: 1 } as const;

/**
 * A scenario with non-zero, deliberately UNEQUAL counts (a merge makes entities
 * differ from nodes) so a field swap or a recount from the wrong source cannot
 * pass by accident. Known values: 3 entities, 1 merge of 2 (survivor keeps the
 * node) => 2 nodes, 1 claim => 1 edge, 2 observations, 1 evidence, 0 notes.
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

describe("P3-012 case stats (أرقام تطابق الإسقاط)", () => {
  it("serves exactly the case's projection counts — the numbers match the projection, from one snapshot", async () => {
    const { call, root } = await start();
    const dir = path.join(root, "case-a");
    const c = openCase(dir, { actor: "analyst", create: { ...CREATE } });
    populate(c);
    c.close();

    // The truth the route must match: the case's own projection.
    const verify = openCase(dir, { readOnly: true, skipChainCheck: true, actor: "system" });
    const projection = verify.projection();
    verify.close();

    const fp = (await call("/cases", withAdmin())).body as { cases: Array<{ id: string }> };
    const caseId = fp.cases[0].id;
    const stats = await call(`/cases/${caseId}/stats`, withAdmin());
    expect(stats.status).toBe(200);
    // The acceptance criterion, literally: the numbers equal the projection.
    expect(stats.body).toEqual({ seq: projection.seq, counts: projection.counts });
    // And the scenario's known values, so a field swap cannot pass by accident.
    expect((stats.body as { counts: Record<string, number> }).counts).toEqual({
      entities: 3,
      nodes: 2, // the merge folds two entities into the survivor's node
      claims: 1,
      edges: 1,
      observations: 2,
      evidence: 1,
      merges: 1,
      notes: 0,
    });
  });

  it("an empty case projects to zero counts with the chain's own seq — not a made-up zero", async () => {
    const { call, root } = await start();
    const dir = path.join(root, "case-empty");
    const c = openCase(dir, { actor: "analyst", create: { ...CREATE } });
    c.close();

    const verify = openCase(dir, { readOnly: true, skipChainCheck: true, actor: "system" });
    const projection = verify.projection();
    verify.close();

    const fp = (await call("/cases", withAdmin())).body as { cases: Array<{ id: string }> };
    const stats = await call(`/cases/${fp.cases[0].id}/stats`, withAdmin());
    expect(stats.status).toBe(200);
    expect(stats.body).toEqual({ seq: projection.seq, counts: projection.counts });
    expect((stats.body as { counts: Record<string, number> }).counts).toMatchObject({
      entities: 0,
      nodes: 0,
      claims: 0,
      edges: 0,
      observations: 0,
      evidence: 0,
      merges: 0,
      notes: 0,
    });
  });

  it("a locked case fails closed with the J-17 message — never zeros that look like statistics", async () => {
    const { call, root } = await start();
    const dir = path.join(root, "case-locked");
    const c = openCase(dir, { actor: "analyst", create: { ...CREATE }, passphrase: "long passphrase", kdf: FAST });
    populate(c);
    c.close();

    const fp = (await call("/cases", withAdmin())).body as { cases: Array<{ id: string; encrypted: boolean }> };
    const locked = fp.cases.find((x) => x.encrypted);
    expect(locked).toBeDefined();
    if (!locked) throw new Error("fixture error: no locked case");
    const stats = await call(`/cases/${locked.id}/stats`, withAdmin());
    expect(stats.status).toBe(403);
    expect(stats.body).toEqual({ error: "مقفلة — تتطلب فك التشفير" });
  });

  it("an unknown case id is 404 and a malformed id never reaches the file system", async () => {
    const { call } = await start();
    expect((await call("/cases/01AAAAAAAAAAAAAAAAAAAAAAAAAA/stats", withAdmin())).status).toBe(404);
    expect((await call("/cases/not-a-ulid/stats", withAdmin())).status).toBe(404);
  });

  it("sits behind the admin boundary (D-037): no token, no statistics", async () => {
    const { call, root } = await start();
    const dir = path.join(root, "case-auth");
    const c = openCase(dir, { actor: "analyst", create: { ...CREATE } });
    populate(c);
    c.close();
    const fp = (await call("/cases", withAdmin())).body as { cases: Array<{ id: string }> };
    const noAuth = await call(`/cases/${fp.cases[0].id}/stats`);
    expect(noAuth.status).toBe(401);
  });
});
