import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  Case,
  CaseInit,
  Claim,
  Entity,
  Evidence,
  LedgerEntry,
  MergeDecision,
  NoteAdded,
  Observation,
  SCHEMAS,
  TransformManifest,
  toJsonSchemas,
} from "./index.ts";

const U = (n: number) => `01J${String(n).padStart(23, "0")}`; // valid ULIDs for fixtures
const T = "2026-10-10T08:00:00.000Z";
const H = "a".repeat(64);

const valid: Record<keyof typeof SCHEMAS, unknown> = {
  Case: {
    id: U(1),
    title: "مراجعة مورّد",
    purpose: "العناية الواجبة قبل التعاقد مع مورّد جديد",
    legalBasis: "due_diligence",
    createdAt: T,
    retention: { mode: "days", days: 365 },
    sensitivity: "standard",
    ownerId: "local",
  },
  Entity: { id: U(2), type: "domain", canonicalKey: "domain:example.com", labels: { en: "example.com" } },
  Identifier: { type: "email", raw: " Info@Example.com", normalized: "info@example.com", validator: "email", confidence: 0.99 },
  Observation: { id: U(3), entityId: U(2), transformId: "tr-001", evidenceId: U(4), observedAt: T, kind: "negative" },
  Claim: { id: U(5), subjectId: U(2), predicate: "resolves_to", objectId: U(6), confidence: 0.9, explanation: "DNS A record" },
  Evidence: {
    id: U(4),
    sha256: H,
    mime: "application/dns-json",
    size: 120,
    blobRef: `blobs/aa/${H}`,
    fetchedAt: T,
    request: {
      method: "GET",
      url: "https://dns.google/resolve?name=example.com",
      headers: { accept: "application/dns-json" },
      status: 200,
    },
    transformId: "tr-001",
    version: "1.0.0",
  },
  LedgerEntry: { seq: 0, prevHash: null, entryHash: H, kind: "case.created", payload: { id: U(1) }, at: T, actor: "local" },
  NoteAdded: { nodeId: U(2), text: "ملاحظة المحلل على هذه العقدة" },
  MergeDecision: {
    id: U(7),
    entityIds: [U(2), U(8)],
    survivorId: U(2),
    reasons: ["same canonicalKey"],
    decidedBy: "analyst",
    decidedAt: T,
  },
  AuditEvent: { id: U(9), at: T, actor: "analyst", action: "gate.confirm", target: U(2), purposeRef: U(1) },
  TransformManifest: {
    id: "TR-001",
    version: "1.0.0",
    inputs: ["domain"],
    outputs: ["ip", "dns_record"],
    network: { mode: "pinned", allow: ["dns.google", "cloudflare-dns.com"] },
    limits: { rps: 5, timeoutMs: 5000, maxBytes: 1_000_000 },
    sensitivity: "normal",
    license: "LC-B",
    admiralty: { reliability: "B", credibility: 3, rationale: "وسيط موثوق نسبياً — تثبيت اختبار" },
  },
  ViewState: { positions: { [U(2)]: { x: 1, y: 2 } }, layout: "force" },
};

describe("@ir/schema round trip (P1-002)", () => {
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    it(`${name}: parse -> JSON -> parse is stable`, () => {
      const once = schema.parse(valid[name as keyof typeof SCHEMAS]);
      const twice = schema.parse(JSON.parse(JSON.stringify(once)));
      expect(twice).toEqual(once);
    });
  }
});

// P3-003 (طلب أ): J-16 — the archive field is backward compatible with existing chains.
describe("Case.archivedAt (P3-003, J-16)", () => {
  it("defaults to null for records written before archival existed", () => {
    const legacy = JSON.parse(JSON.stringify(valid.Case)) as Record<string, unknown> & { archivedAt?: string | null };
    delete legacy.archivedAt;
    expect(Case.parse(legacy).archivedAt).toBeNull();
  });

  it("carries the archival timestamp and is omitted from the create input", () => {
    const withArchive = JSON.parse(JSON.stringify(valid.Case)) as Record<string, unknown>;
    withArchive.archivedAt = "2026-10-19T00:00:00.000Z";
    expect(Case.parse(withArchive).archivedAt).toBe("2026-10-19T00:00:00.000Z");
    expect("archivedAt" in CaseInit.parse(valid.Case)).toBe(false);
  });
});

describe("@ir/schema rejects invalid data", () => {
  const bad = (schema: { safeParse(v: unknown): { success: boolean } }, v: unknown) => expect(schema.safeParse(v).success).toBe(false);
  const base = valid as Record<string, Record<string, unknown>>;

  it("E-01: a case without a stated purpose or with an unknown basis", () => {
    bad(Case, { ...base.Case, purpose: "" });
    bad(Case, { ...base.Case, purpose: "short" });
    bad(Case, { ...base.Case, legalBasis: "curiosity" });
  });
  it("D-020/D-021: canonicalKey must be <type>:<normalized> of the same type", () => {
    bad(Entity, { ...base.Entity, canonicalKey: "example.com" });
    bad(Entity, { ...base.Entity, canonicalKey: "email:example.com" });
    bad(Entity, { ...base.Entity, id: "not-a-ulid" });
  });
  it("D3: an observation targets exactly one of entity or claim", () => {
    bad(Observation, { ...base.Observation, claimId: U(5) });
    bad(Observation, { ...base.Observation, entityId: undefined });
  });
  it("D-025: a claim needs a typed predicate and exactly one object", () => {
    bad(Claim, { ...base.Claim, predicate: "" });
    bad(Claim, { ...base.Claim, value: "1.2.3.4" });
    bad(Claim, { ...base.Claim, validFrom: "2026-02-01T00:00:00Z", validTo: "2026-01-01T00:00:00Z" });
  });
  it("D1/5.5: evidence blobRef matches its hash and secret headers are not stored", () => {
    bad(Evidence, { ...base.Evidence, blobRef: `blobs/bb/${H}` });
    bad(Evidence, { ...base.Evidence, request: { method: "GET", url: "https://x", headers: { Authorization: "Bearer k" } } });
  });
  it("ledger: only the genesis entry has no prevHash", () => {
    bad(LedgerEntry, { ...base.LedgerEntry, seq: 1 });
    bad(LedgerEntry, { ...base.LedgerEntry, prevHash: H });
  });
  it("D9: merge survivor is one of the merged entities", () => {
    bad(MergeDecision, { ...base.MergeDecision, survivorId: U(99) });
    bad(MergeDecision, { ...base.MergeDecision, entityIds: [U(2), U(2)] });
  });
  it("P3-021: a note targets a node by its permanent id and carries non-empty text", () => {
    expect(SCHEMAS).toHaveProperty("NoteAdded");
    bad(NoteAdded, { ...base.NoteAdded, nodeId: "not-a-ulid" });
    bad(NoteAdded, { ...base.NoteAdded, text: "" });
    bad(NoteAdded, { ...base.NoteAdded, text: "x".repeat(2001) });
  });
  it("P2-004: a transform manifest without a network mode is invalid (fail-closed)", () => {
    bad(TransformManifest, { ...base.TransformManifest, network: { allow: ["dns.google"] } });
    bad(TransformManifest, { ...base.TransformManifest, network: { mode: "pinned", allow: [] } });
    bad(TransformManifest, { ...base.TransformManifest, network: { mode: "public", allow: ["dns.google"] } });
  });
});

describe("generated JSON Schema", () => {
  it("packages/schema/json is up to date (run: pnpm --filter @ir/schema run gen:jsonschema)", () => {
    for (const [name, schema] of Object.entries(toJsonSchemas())) {
      const file = readFileSync(join(__dirname, "..", "json", `${name}.schema.json`), "utf8");
      expect(JSON.parse(file)).toEqual(schema);
    }
  });
});
