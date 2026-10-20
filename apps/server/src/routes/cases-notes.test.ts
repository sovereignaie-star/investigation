// P3-021 («ملاحظة»): POST /cases/:id/notes — the context-menu note action's data path.
// The note is REAL case data: a `note.added` ledger event (the kind already exists in
// the schema and the projection counts it), appended through the case store's write
// path with the same admin boundary, rate limit and fail-closed locked/archived
// posture as every case write. The target is the node's permanent entity id; the
// route verifies it exists in the case's own projection before appending — a note
// about a node the case does not contain is a 422, never a silently orphaned event.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openCase } from "@ir/store";
import { ulidFactory } from "@ir/core";
import { createApp } from "../app";
import { casesRouter } from "./cases";

const ulid = ulidFactory();
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

function json(init: RequestInit, body: unknown): RequestInit {
  return { ...init, method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

const CREATE = {
  title: "شبكة تجارة إلكترونية مشبوهة",
  purpose: "تتبع شبكة شركات وأشخاص عامين لتحقيق صحفي استقصائي موثق الغرض",
  legalBasis: "journalism",
};

async function start() {
  const root = mkdtempSync(path.join(tmpdir(), "ir-notes-"));
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
    return { status: res.status, body };
  };
  return { call, root };
}

/** Creates a case via the API and seeds one domain node directly in its ledger. */
async function caseWithNode(root: string, call: Awaited<ReturnType<typeof start>>["call"]): Promise<{ caseId: string; nodeId: string }> {
  const res = await call("/cases", withAdmin(json({}, CREATE)));
  expect(res.status).toBe(201);
  const caseId = (res.body as { id: string }).id;
  const dir = path.join(root, caseId);
  const c = openCase(dir, { actor: "test" });
  try {
    const nodeId = ulid();
    c.append("entity.added", { id: nodeId, type: "domain", canonicalKey: "domain:example.com", labels: { ar: "example.com" }, props: {} });
    return { caseId, nodeId };
  } finally {
    c.close();
  }
}

describe("P3-021 notes API (POST /cases/:id/notes)", () => {
  it("appends a note.added event for a node the case contains; the projection carries it", async () => {
    const { call, root } = await start();
    const { caseId, nodeId } = await caseWithNode(root, call);
    const res = await call(`/cases/${caseId}/notes`, withAdmin(json({}, { nodeId, text: "التحقق من السجل يحتاج مصدراً ثانياً" })));
    expect(res.status).toBe(201);
    const note = res.body as { seq: number; nodeId: string; text: string; at: string; actor: string };
    expect(note.nodeId).toBe(nodeId);
    expect(note.text).toBe("التحقق من السجل يحتاج مصدراً ثانياً");
    expect(note.actor).toBe("web");

    // The served projection (the workbench's re-fetch path) carries the note.
    const projection = await call(`/cases/${caseId}/projection`, withAdmin());
    expect(projection.status).toBe(200);
    const p = projection.body as { notes?: Array<{ nodeId: string; text: string }>; counts: { notes: number } };
    expect(p.counts.notes).toBe(1);
    expect(p.notes?.[0]).toMatchObject({ nodeId, text: "التحقق من السجل يحتاج مصدراً ثانياً" });
  });

  it("422: a note about a node the case does not contain is refused, nothing is appended", async () => {
    const { call, root } = await start();
    const { caseId } = await caseWithNode(root, call);
    const res = await call(`/cases/${caseId}/notes`, withAdmin(json({}, { nodeId: ulid(), text: "عن عقدة غير موجودة" })));
    expect(res.status).toBe(422);
    const projection = await call(`/cases/${caseId}/projection`, withAdmin());
    expect((projection.body as { counts: { notes: number } }).counts.notes).toBe(0);
  });

  it("400: an empty text or a malformed body is rejected", async () => {
    const { call, root } = await start();
    const { caseId, nodeId } = await caseWithNode(root, call);
    expect((await call(`/cases/${caseId}/notes`, withAdmin(json({}, { nodeId, text: "" })))).status).toBe(400);
    expect((await call(`/cases/${caseId}/notes`, withAdmin(json({}, { text: "بلا هدف" })))).status).toBe(400);
  });

  it("fail-closed: locked and archived cases refuse notes; unknown cases are 404; no token is 401", async () => {
    const { call, root } = await start();
    const locked = await call("/cases", withAdmin(json({}, { ...CREATE, title: "مشفرة", passphrase: "سر-قوي-جدا" })));
    const lockedId = (locked.body as { id: string }).id;
    const seeded = await caseWithNode(root, call);
    const archive = await call(
      `/cases/${seeded.caseId}`,
      withAdmin({ ...json({}, { action: "archive", reason: "اكتمل التحقيق" }), method: "PATCH" }),
    );
    expect(archive.status).toBe(200);

    expect((await call(`/cases/${lockedId}/notes`, withAdmin(json({}, { nodeId: ulid(), text: "ملاحظة" })))).status).toBe(403);
    // J-16: an archived case is write-blocked — notes are content writes.
    expect((await call(`/cases/${seeded.caseId}/notes`, withAdmin(json({}, { nodeId: seeded.nodeId, text: "ملاحظة" })))).status).toBe(409);
    expect((await call(`/cases/${ulid()}/notes`, withAdmin(json({}, { nodeId: ulid(), text: "ملاحظة" })))).status).toBe(404);
    expect((await call(`/cases/${seeded.caseId}/notes`, json({}, { nodeId: seeded.nodeId, text: "ملاحظة" }))).status).toBe(401);
  });
});
