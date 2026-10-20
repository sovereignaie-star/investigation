// P3-015 red-first: the projection read route is the data path of «فتح قضية بعد
// إعادة التشغيل» (open a case after restart). The route serves the case's own
// projection snapshot — the exact shape `ir project --json` emits
// ({...projection, sha256}) — from the durable SQLite store, never a parallel
// rebuild in the UI. Locked cases fail closed with the J-17 message (never an
// empty graph that looks like an opened case), unknown or malformed ids are
// 404, and the route sits behind the same admin boundary as every case route
// (D-037). The restart acceptance itself is measured below: the case is
// created in one process/instance, its handles closed, and a FRESH server
// instance over the same data root serves the persisted graph.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { casesRouter } from "./cases";
import { openCase, type Case } from "@ir/store";
import { projectionHash } from "@ir/ledger/projections";
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
  const root = mkdtempSync(path.join(tmpdir(), "ir-cases-proj-"));
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
  title: "قضية اختبار الفتح بعد إعادة التشغيل",
  purpose: "تتبع كيانات عامة لاختبار فتح القضية بعد إعادة التشغيل",
  legalBasis: "due_diligence",
} as const;

/**
 * A scenario with known, deliberately UNEQUAL content (3 entities, 2 merged into
 * 1 node, 1 claim between two DISTINCT nodes => 1 edge) so a field swap or an
 * empty/fabricated graph cannot pass by accident. Known values: 3 entities,
 * 1 merge => 2 nodes, 1 claim => 1 edge, 1 evidence, 1 observation.
 */
function populate(c: Case): { caseId: string } {
  const ents = ["example.com", "mail.example.com", "192.0.2.7"].map((v, i) => {
    const type = ["domain", "domain", "ipv4"][i] as string;
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
  const claim = { id: id(), subjectId: ents[0], predicate: "dns.a", objectId: ents[2], confidence: 0.9, explanation: "A record" };
  c.append("claim.added", claim);
  c.append("observation.added", {
    id: id(),
    claimId: claim.id,
    transformId: "tr-dns",
    evidenceId: ev.id,
    observedAt: "2026-10-10T12:00:01.000Z",
    kind: "positive",
  });
  c.append("merge.decided", {
    id: id(),
    entityIds: [ents[0], ents[1]],
    survivorId: ents[0],
    reasons: ["same registrant per test"],
    decidedBy: "tester",
    decidedAt: "2026-10-10T12:00:03.000Z",
    reverted: false,
  });
  return { caseId: (c.info() as { id: string }).id };
}

describe("P3-015 case projection (فتح قضية بعد إعادة التشغيل)", () => {
  it("ACCEPTANCE — a fresh server over the same data root serves the case's persisted graph after restart", async () => {
    // Session 1: create the case with known content, then close every handle.
    const { root } = await start();
    const dir = path.join(root, "case-a");
    const c = openCase(dir, { actor: "analyst", create: { ...CREATE } });
    const { caseId } = populate(c);
    const seq = c.projection().seq;
    const localGraph = c.projection().graph;
    c.close();
    // No handle, no cache: everything the next server instance knows comes from disk.

    // Session 2 (restart): a FRESH router/server pair over the same root.
    const app2 = createApp(casesRouter(() => root, { env: ENABLED }));
    const server2 = app2.listen(0, "127.0.0.1");
    servers.push(server2);
    await new Promise((r) => server2.once("listening", r));
    const base = `http://127.0.0.1:${(server2.address() as AddressInfo).port}/api`;
    const res = await fetch(`${base}/cases/${caseId}/projection`, withAdmin());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      seq: number;
      graph: { nodes: unknown[]; edges: unknown[] };
      counts: Record<string, number>;
      sha256: string;
    };
    // The persisted content survived the restart: same seq, same graph, same counts.
    expect(body.seq).toBe(seq);
    expect(body.graph.nodes).toHaveLength(localGraph.nodes.length);
    expect(body.graph.edges).toHaveLength(localGraph.edges.length);
    expect(body.counts["entities"]).toBe(3);
    expect(body.counts["nodes"]).toBe(2);
    expect(body.counts["edges"]).toBe(1);
    expect(body.counts["evidence"]).toBe(1);
    expect(body.counts["observations"]).toBe(1);
    expect(body.counts["merges"]).toBe(1);
  });

  it("serves exactly {...projection, sha256: projectionHash(projection)} — the case's own snapshot, never a parallel rebuild", async () => {
    const { call, root } = await start();
    const dir = path.join(root, "case-b");
    const c = openCase(dir, { actor: "analyst", create: { ...CREATE } });
    const { caseId } = populate(c);
    const p = c.projection();
    c.close();
    const res = await call(`/cases/${caseId}/projection`, withAdmin());
    expect(res.status).toBe(200);
    const body = res.body as { seq: number; sha256: string };
    expect(body.seq).toBe(p.seq);
    // The sha256 is the official computer's hash over the same snapshot — a
    // fabricated or field-swapped body cannot reproduce it.
    expect(body.sha256).toBe(projectionHash(p));
  });

  it("an empty case opens honestly: the chain's own seq, zero counts, empty graph — never an error dressed as empty", async () => {
    const { call, root } = await start();
    const dir = path.join(root, "case-empty");
    const c = openCase(dir, { actor: "analyst", create: { ...CREATE } });
    const { caseId } = { caseId: (c.info() as { id: string }).id };
    const emptySeq = c.projection().seq; // the chain's own seq (case.created is already in it)
    c.close();
    const res = await call(`/cases/${caseId}/projection`, withAdmin());
    expect(res.status).toBe(200);
    const body = res.body as { seq: number; graph: { nodes: unknown[]; edges: unknown[] }; counts: Record<string, number> };
    expect(body.seq).toBe(emptySeq);
    expect(body.graph.nodes).toHaveLength(0);
    expect(body.graph.edges).toHaveLength(0);
    expect(body.counts["entities"]).toBe(0);
  });

  it("J-17: a locked case fails closed with the locked message — never an empty graph that looks like an opened case", async () => {
    const { call, root } = await start();
    const dir = path.join(root, "case-locked");
    const c = openCase(dir, { actor: "analyst", create: { ...CREATE }, passphrase: "passphrase-for-test" });
    const { caseId } = populate(c);
    c.close();
    const res = await call(`/cases/${caseId}/projection`, withAdmin());
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "مقفلة — تتطلب فك التشفير" });
  });

  it("an unknown or malformed id is 404 — never a path", async () => {
    const { call } = await start();
    expect((await call("/cases/01M58XF9ZKJT50S8E8JYXF6P3ZZ/projection", withAdmin())).status).toBe(404);
    expect((await call("/cases/not-a-ulid/projection", withAdmin())).status).toBe(404);
    expect((await call("/cases/..%2F..%2Fetc/projection", withAdmin())).status).toBe(404);
  });

  it("sits behind the admin boundary (D-037): no token is 401", async () => {
    const { call, root } = await start();
    const dir = path.join(root, "case-auth");
    const c = openCase(dir, { actor: "analyst", create: { ...CREATE } });
    const { caseId } = { caseId: (c.info() as { id: string }).id };
    c.close();
    expect((await call(`/cases/${caseId}/projection`)).status).toBe(401);
  });
});
