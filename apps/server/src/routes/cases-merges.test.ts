// P4-005 (UC-11 «دمج كيانين متشابهين بأسباب»): the merge-review data path —
// suggestions on EXPLICIT request only (no background job), a human-accepted
// merge as a `merge.decided` ledger event, and a revert that restores the
// case's contract-covered semantic state (ROADMAP: «التراجع يعيد الحالة بايتاً
// ببايت»). The server NEVER trusts client-sent scores/reasons: it re-derives
// the reasons itself with the pinned model (er-model/1), and every write
// carries the case version stamp it was validated against (stale requests
// fail closed with no partial write). Suggestions never mutate the case.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verify } from "@ir/ledger";
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
  const root = mkdtempSync(path.join(tmpdir(), "ir-merges-"));
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

/**
 * Two REAL entities with DIFFERENT canonicalKeys (the projection auto-unifies
 * identical keys, so a merge fixture must not share one), similar enough for
 * the pinned er-model/1 to suggest them strongly: identical name (agree),
 * same country and same birth date (agree). The third entity is dissimilar.
 */
async function caseWithEntities(root: string, call: Awaited<ReturnType<typeof start>>["call"]) {
  const res = await call("/cases", withAdmin(json({}, CREATE)));
  expect(res.status).toBe(201);
  const caseId = (res.body as { id: string }).id;
  const dir = path.join(root, caseId);
  const c = openCase(dir, { actor: "test" });
  try {
    const a = ulid();
    const b = ulid();
    const far = ulid();
    c.append("entity.added", {
      id: a,
      type: "person",
      canonicalKey: "person:muhammad-al-salem-aa1",
      labels: { ar: "محمد السالم" },
      props: { country: "SA", birthDate: "1980-05-01" },
    });
    c.append("entity.added", {
      id: b,
      type: "person",
      canonicalKey: "person:muhammad-al-salem-bb2",
      labels: { ar: "محمد السالم" },
      props: { country: "SA", birthDate: "1980-05-01" },
    });
    c.append("entity.added", {
      id: far,
      type: "domain",
      canonicalKey: "domain:unrelated.example",
      labels: { ar: "unrelated.example" },
      props: {},
    });
    return { caseId, a, b, far, dir };
  } finally {
    c.close();
  }
}

interface SuggestionWire {
  aId: string;
  bId: string;
  score: number;
  decision: string;
  reasons: { feature: string; weight: number; detail: string }[];
}
interface SuggestionsWire {
  modelVersion: string;
  caseVersion: number;
  suggestions: SuggestionWire[];
}

/** GET /cases/:id/merge-suggestions through the API. */
async function getSuggestions(call: Awaited<ReturnType<typeof start>>["call"], caseId: string): Promise<{ status: number; body: unknown }> {
  return call(`/cases/${caseId}/merge-suggestions`, withAdmin());
}

/** The case's own ledger length (seq of the last entry + 1) straight from the store. */
function ledgerCount(dir: string): number {
  const c = openCase(dir, { readOnly: true, skipChainCheck: true, actor: "system" });
  try {
    return c.entries().length;
  } finally {
    c.close();
  }
}

/** The semantic projection minus the fields a merge/revert legitimately changes. */
async function semanticProjection(call: Awaited<ReturnType<typeof start>>["call"], caseId: string): Promise<unknown> {
  const res = await call(`/cases/${caseId}/projection`, withAdmin());
  expect(res.status).toBe(200);
  const p = JSON.parse(JSON.stringify(res.body));
  // Necessarily-changing audit fields: seq, sha256, the merge log and its count.
  delete p.seq;
  delete p.sha256;
  delete p.mergeDecisions;
  if (p.counts) delete p.counts.merges;
  return p;
}

describe("P4-005 merge review API (UC-11)", () => {
  it("T-MR-001: GET /merge-suggestions returns the pinned model's suggestions and writes NOTHING (explicit request only)", async () => {
    const { call, root } = await start();
    const { caseId, a, b, dir } = await caseWithEntities(root, call);
    const before = ledgerCount(dir);
    const res = await getSuggestions(call, caseId);
    expect(res.status).toBe(200);
    const body = res.body as SuggestionsWire;
    expect(body.modelVersion).toBe("er-model/2"); // P5-003: ترقية معلنة للتطبيع العربي الكامل
    expect(body.caseVersion).toBeGreaterThan(0);
    const pair = body.suggestions.find((s) => [s.aId, s.bId].sort().join("|") === [a, b].sort().join("|"));
    expect(pair).toBeDefined();
    if (!pair) throw new Error("the similar pair must be suggested");
    expect(pair.decision).toBe("strong");
    expect(pair.reasons.length).toBeGreaterThan(0);
    // suggestions never mutate: the ledger is byte-for-byte unchanged
    expect(ledgerCount(dir)).toBe(before);
  });

  it("T-MR-002: accepting a suggestion appends merge.decided with SERVER-derived reasons and merges the nodes in the projection", async () => {
    const { call, root } = await start();
    const { caseId, a, b, dir } = await caseWithEntities(root, call);
    const sugg = (await getSuggestions(call, caseId)).body as SuggestionsWire;
    const nodesBefore = ((await call(`/cases/${caseId}/projection`, withAdmin())).body as { graph: { nodes: unknown[] } }).graph.nodes
      .length;
    const res = await call(
      `/cases/${caseId}/merges`,
      withAdmin(json({}, { entityIds: [a, b], survivorId: a, modelVersion: sugg.modelVersion, caseVersion: sugg.caseVersion })),
    );
    expect(res.status).toBe(201);
    const merge = res.body as { id: string; entityIds: string[]; survivorId: string; reasons: unknown[]; decidedBy: string };
    expect(merge.entityIds).toEqual([a, b]);
    expect(merge.survivorId).toBe(a);
    // the SERVER derived the reasons (never trusted from the client)
    expect(merge.reasons.length).toBeGreaterThan(0);
    // the projection now merges the two entities into one node
    const nodesAfter = ((await call(`/cases/${caseId}/projection`, withAdmin())).body as { graph: { nodes: unknown[] } }).graph.nodes
      .length;
    expect(nodesAfter).toBe(nodesBefore - 1);
    // the ledger carries the event and the audit trail records the action
    const c = openCase(dir, { readOnly: true, skipChainCheck: true, actor: "system" });
    try {
      const decided = c.entries().filter((e) => e.kind === "merge.decided");
      expect(decided).toHaveLength(1);
      expect(c.auditTrail().some((ev) => ev.action.includes("merge"))).toBe(true);
    } finally {
      c.close();
    }
  });

  it("T-MR-003: reverting the merge restores the case's semantic state byte-for-byte (both events stay in the valid ledger)", async () => {
    const { call, root } = await start();
    const { caseId, a, b } = await caseWithEntities(root, call);
    const before = await semanticProjection(call, caseId);
    const sugg = (await getSuggestions(call, caseId)).body as SuggestionsWire;
    const accept = await call(
      `/cases/${caseId}/merges`,
      withAdmin(json({}, { entityIds: [a, b], survivorId: a, modelVersion: sugg.modelVersion, caseVersion: sugg.caseVersion })),
    );
    expect(accept.status).toBe(201);
    const mergeId = (accept.body as { id: string }).id;
    const reverted = await call(`/cases/${caseId}/merges/${mergeId}/revert`, withAdmin(json({}, {})));
    expect(reverted.status).toBe(200);
    // both events remain in the ledger — the revert is an event, not a deletion
    const dir = path.join(root, caseId);
    const c = openCase(dir, { readOnly: true, skipChainCheck: true, actor: "system" });
    try {
      expect(c.entries().filter((e) => e.kind === "merge.decided")).toHaveLength(1);
      expect(c.entries().filter((e) => e.kind === "merge.reverted")).toHaveLength(1);
      // the whole chain — including BOTH merge events — is a valid ledger
      expect(verify(c.entries()).ok).toBe(true);
    } finally {
      c.close();
    }
    // the semantic state (graph, table, coverage, counts minus merges, notes) is identical
    const after = await semanticProjection(call, caseId);
    expect(after).toEqual(before);
  });

  it("T-MR-004: the reverted state survives closing and re-opening the case (durability, not a memory artifact)", async () => {
    const { call, root } = await start();
    const { caseId, a, b } = await caseWithEntities(root, call);
    const before = await semanticProjection(call, caseId);
    const sugg = (await getSuggestions(call, caseId)).body as SuggestionsWire;
    const accept = await call(
      `/cases/${caseId}/merges`,
      withAdmin(json({}, { entityIds: [a, b], survivorId: a, modelVersion: sugg.modelVersion, caseVersion: sugg.caseVersion })),
    );
    expect(accept.status).toBe(201); // the merge MUST have happened — this test cannot pass vacuously
    const mergeId = (accept.body as { id: string }).id;
    const revert = await call(`/cases/${caseId}/merges/${mergeId}/revert`, withAdmin(json({}, {})));
    expect(revert.status).toBe(200);
    // every read above opens/closes the case already; this read is a fresh open
    const after = await semanticProjection(call, caseId);
    expect(after).toEqual(before);
  });

  it("T-MR-005: a repeated accept of the same pair is 409 (no second event, no partial write)", async () => {
    const { call, root } = await start();
    const { caseId, a, b, dir } = await caseWithEntities(root, call);
    const sugg = (await getSuggestions(call, caseId)).body as SuggestionsWire;
    const first = await call(
      `/cases/${caseId}/merges`,
      withAdmin(json({}, { entityIds: [a, b], survivorId: a, modelVersion: sugg.modelVersion, caseVersion: sugg.caseVersion })),
    );
    expect(first.status).toBe(201);
    const count = ledgerCount(dir);
    const second = await call(
      `/cases/${caseId}/merges`,
      withAdmin(json({}, { entityIds: [a, b], survivorId: a, modelVersion: sugg.modelVersion, caseVersion: sugg.caseVersion + 1 })),
    );
    expect(second.status).toBe(409);
    expect(ledgerCount(dir)).toBe(count); // nothing was appended
  });

  it("T-MR-006: a repeated revert is an idempotent 200 with NO new event", async () => {
    const { call, root } = await start();
    const { caseId, a, b, dir } = await caseWithEntities(root, call);
    const sugg = (await getSuggestions(call, caseId)).body as SuggestionsWire;
    const accept = await call(
      `/cases/${caseId}/merges`,
      withAdmin(json({}, { entityIds: [a, b], survivorId: a, modelVersion: sugg.modelVersion, caseVersion: sugg.caseVersion })),
    );
    const mergeId = (accept.body as { id: string }).id;
    const first = await call(`/cases/${caseId}/merges/${mergeId}/revert`, withAdmin(json({}, {})));
    expect(first.status).toBe(200);
    const count = ledgerCount(dir);
    const second = await call(`/cases/${caseId}/merges/${mergeId}/revert`, withAdmin(json({}, {})));
    expect(second.status).toBe(200);
    expect(ledgerCount(dir)).toBe(count); // no duplicate revert event
  });

  it("T-MR-007: a stale caseVersion is rejected cleanly (concurrent-change protection, no partial write)", async () => {
    const { call, root } = await start();
    const { caseId, a, b, dir } = await caseWithEntities(root, call);
    const sugg = (await getSuggestions(call, caseId)).body as SuggestionsWire;
    const staleVersion = sugg.caseVersion - 1;
    const res = await call(
      `/cases/${caseId}/merges`,
      withAdmin(json({}, { entityIds: [a, b], survivorId: a, modelVersion: sugg.modelVersion, caseVersion: staleVersion })),
    );
    expect(res.status).toBe(409);
    expect(ledgerCount(dir)).toBe(sugg.caseVersion + 1); // nothing appended (count = seq + 1)
  });

  it("T-MR-008: an unknown modelVersion is rejected (the pinned model is part of the contract)", async () => {
    const { call, root } = await start();
    const { caseId, a, b } = await caseWithEntities(root, call);
    const sugg = (await getSuggestions(call, caseId)).body as SuggestionsWire;
    const res = await call(
      `/cases/${caseId}/merges`,
      withAdmin(json({}, { entityIds: [a, b], survivorId: a, modelVersion: "er-model/999", caseVersion: sugg.caseVersion })),
    );
    expect(res.status).toBe(409);
  });

  it("T-MR-009: entities not in the case's own projection are a 422, never an orphaned event", async () => {
    const { call, root } = await start();
    const { caseId, a, dir } = await caseWithEntities(root, call);
    const sugg = (await getSuggestions(call, caseId)).body as SuggestionsWire;
    const ghost = ulid();
    const res = await call(
      `/cases/${caseId}/merges`,
      withAdmin(json({}, { entityIds: [a, ghost], survivorId: a, modelVersion: sugg.modelVersion, caseVersion: sugg.caseVersion })),
    );
    expect(res.status).toBe(422);
    expect(ledgerCount(dir)).toBe(sugg.caseVersion + 1); // nothing appended (count = seq + 1)
  });

  it("T-MR-010: the merge requires exactly two entities and a survivor among them", async () => {
    const { call, root } = await start();
    const { caseId, a, b, far } = await caseWithEntities(root, call);
    const sugg = (await getSuggestions(call, caseId)).body as SuggestionsWire;
    // cardinality violations are rejected at the input-schema level (400 — the notes pattern)
    const one = await call(
      `/cases/${caseId}/merges`,
      withAdmin(json({}, { entityIds: [a], survivorId: a, modelVersion: sugg.modelVersion, caseVersion: sugg.caseVersion })),
    );
    expect(one.status).toBe(400);
    const three = await call(
      `/cases/${caseId}/merges`,
      withAdmin(json({}, { entityIds: [a, b, far], survivorId: a, modelVersion: sugg.modelVersion, caseVersion: sugg.caseVersion })),
    );
    expect(three.status).toBe(400);
    const badSurvivor = await call(
      `/cases/${caseId}/merges`,
      withAdmin(json({}, { entityIds: [a, b], survivorId: far, modelVersion: sugg.modelVersion, caseVersion: sugg.caseVersion })),
    );
    expect(badSurvivor.status).toBe(422);
  });

  it("T-MR-011: suggestions exclude pairs whose nodes are already merged (no duplicate suggestions between the same groups)", async () => {
    const { call, root } = await start();
    const { caseId, a, b } = await caseWithEntities(root, call);
    const sugg = (await getSuggestions(call, caseId)).body as SuggestionsWire;
    await call(
      `/cases/${caseId}/merges`,
      withAdmin(json({}, { entityIds: [a, b], survivorId: a, modelVersion: sugg.modelVersion, caseVersion: sugg.caseVersion })),
    );
    const after = (await getSuggestions(call, caseId)).body as SuggestionsWire;
    expect(after.suggestions.some((s) => [s.aId, s.bId].sort().join("|") === [a, b].sort().join("|"))).toBe(false);
  });

  it("T-MR-012: the merge log (decisions with ids and revert state) is served to the client for the revert action", async () => {
    const { call, root } = await start();
    const { caseId, a, b } = await caseWithEntities(root, call);
    const sugg = (await getSuggestions(call, caseId)).body as SuggestionsWire;
    const accept = await call(
      `/cases/${caseId}/merges`,
      withAdmin(json({}, { entityIds: [a, b], survivorId: a, modelVersion: sugg.modelVersion, caseVersion: sugg.caseVersion })),
    );
    const mergeId = (accept.body as { id: string }).id;
    const res = await call(`/cases/${caseId}/merges`, withAdmin());
    expect(res.status).toBe(200);
    const list = res.body as { merges: { id: string; entityIds: string[]; survivorId: string; reverted: boolean }[] };
    const mine = list.merges.find((m) => m.id === mergeId);
    expect(mine).toBeDefined();
    if (!mine) throw new Error("the merge must be in the log");
    expect(mine.reverted).toBe(false);
    expect(mine.entityIds).toEqual([a, b]);
  });

  it("T-MR-013: merging entities of different types is refused unless the declared compatibility table allows it", async () => {
    const { call, root } = await start();
    const { caseId, a, far } = await caseWithEntities(root, call);
    const sugg = (await getSuggestions(call, caseId)).body as SuggestionsWire;
    const res = await call(
      `/cases/${caseId}/merges`,
      withAdmin(json({}, { entityIds: [a, far], survivorId: a, modelVersion: sugg.modelVersion, caseVersion: sugg.caseVersion })),
    );
    expect(res.status).toBe(422);
  });
});
