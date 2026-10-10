import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { manualClock, seededRandom, ulidFactory } from "@ir/core";
import { project, projectionHash } from "@ir/ledger/projections";
import { CaseLockedError, openCase, type Case } from "./index.ts";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "ir-proj-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const CREATE = { title: "إسقاطات", purpose: "تحقق من بنية تحتية لنطاق", legalBasis: "due_diligence" } as const;
const FAST = { memoryKiB: 256, passes: 1, parallelism: 1 };

function populate(c: Case, seed: number) {
  const clock = manualClock("2026-10-10T12:00:00.000Z");
  const id = ulidFactory(clock, seededRandom(seed));
  const ents = ["a@example.com", "example.com", "192.0.2.7"].map((v, i) => {
    const type = ["email", "domain", "ipv4"][i] as string;
    const e = { id: id(), type, canonicalKey: `${type}:${v}`, labels: { en: v, ar: `قيمة ${i}` }, props: { i } };
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
  return ents;
}

describe("Case.projection (P1-016)", () => {
  for (const encrypted of [false, true]) {
    it(`${encrypted ? "encrypted" : "plain"} case: the live projection equals a rebuild from case.sqlite after reopening`, () => {
      const dir = tmp();
      const opts = { actor: "analyst", create: CREATE, ...(encrypted ? { passphrase: "long passphrase", kdf: FAST } : {}) };
      const c = openCase(dir, opts);
      const early = c.projection(); // built now, then kept live by every append below
      expect(early.counts.entities).toBe(0);
      const ents = populate(c, 5);
      const live = c.projection();
      expect(live.counts).toMatchObject({ entities: 3, edges: 1, observations: 2, evidence: 1 });
      expect(live.coverage.cells.map((x) => [x.entityId, x.transformId, x.last])).toEqual(
        [
          [ents[0], "tr-breach", "negative"],
          [ents[1], "tr-dns", "positive"],
        ].sort((a, b) => ((a[0] as string) + a[1] < (b[0] as string) + b[1] ? -1 : 1)),
      );
      expect(live.issues).toEqual([]);
      const h = projectionHash(live);
      expect(h).toBe(projectionHash(project(c.entries())));
      c.close();

      const again = openCase(dir, { actor: "analyst", ...(encrypted ? { passphrase: "long passphrase" } : {}) });
      // unlocking an encrypted case is itself audited (P1-017), so the chain grows; the snapshot at the old seq is
      // byte-identical, and the views are unchanged because audit entries are not part of them
      expect(projectionHash(project(again.entries(), { upTo: live.seq }))).toBe(h);
      const now = again.projection();
      expect(now.seq).toBe(encrypted ? live.seq + 1 : live.seq);
      expect({ graph: now.graph, table: now.table, coverage: now.coverage }).toEqual({
        graph: live.graph,
        table: live.table,
        coverage: live.coverage,
      });
      again.close();
    });
  }

  it("a locked case cannot be projected (its payloads are sealed)", () => {
    const dir = tmp();
    openCase(dir, { actor: "a", passphrase: "long passphrase", kdf: FAST, create: CREATE }).close();
    const locked = openCase(dir, { actor: "a" });
    expect(() => locked.projection()).toThrow(CaseLockedError);
    locked.close();
  });
});
