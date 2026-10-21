import { manualClock, seededRandom, ulidFactory } from "@ir/core";
import { describe, expect, it } from "vitest";
import { Ledger } from "../index.ts";
import { project } from "./index.ts";

/**
 * P4-006 — الزمن ثنائي البعد في الإسقاطات (T-TIME-001..005, ROADMAP 5.15/D4).
 *
 * الزمنان اللذان يجب ألا يختلطا أبداً:
 *  - وقت الصلاحية (validFrom/validTo): متى كان الادعاء صحيحاً في العالم.
 *  - وقت الرصد (observedAt): متى رصدناه — والملاحظة تحمله، لا الادعاء.
 * ووقت ثالث خارج النقاش: وقت إلحاق الحدث في السجل (entry.at) — لا يحل محل أياً منهما.
 *
 * النطاق: المخطط والإسقاطات فقط. اللقطات والمقارنة (diff) هما P4-008 (T-TIME-006..010)،
 * وعدم اليقين الزمني وفتراته يتبعان العرض (P4-007/UC-08) — لا شيء منهما هنا.
 *
 * صادق الأدلة: T-TIME-001/002/004 حمراء (سلوك جديد/خلل كامن)، T-TIME-003/005 تتحقق من
 * سلوك قائم جزئياً — موسومة بذلك في متنها، والتشغيل الفعلي موثق في WORKLOG قبل أي تنفيذ.
 * T-TIME-004b كُتب أحمر بعد جولة مراجعة التحقق: المخطط يقبل كسور ثانية دون الملي ثانية
 * (متحقق: 7 خانات تمرّ) بينما Date.parse يدمجها — أُصلح المقارن بعده (دقة نانوثانية معلنة).
 * T-TIME-001b تغطية تكميلية معلنة لسلوك قائم (كسر التعادل بالمعرّف + نوع error)، ليست دليلاً أحمر أصلياً.
 */

const T0 = "2026-10-10T08:00:00.000Z";

/** One observation as the projection serves it per claim — full fidelity, nothing collapsed. */
interface ClaimObservation {
  observationId: string;
  evidenceId: string;
  observedAt: string;
  kind: "positive" | "negative" | "error";
}

function fixture(seed = 7) {
  const clock = manualClock(T0);
  const id = ulidFactory(clock, seededRandom(seed));
  const ledger = new Ledger({ actor: "tester", clock });
  const add = (kind: Parameters<Ledger["append"]>[0], payload: unknown) => {
    clock.advance(1000);
    return ledger.append(kind, payload);
  };
  const entity = (type: string, value: string, label = value) => {
    const e = { id: id(), type, canonicalKey: `${type}:${value}`, labels: { en: label }, props: {} };
    add("entity.added", e);
    return e.id;
  };
  const claim = (
    subjectId: string,
    predicate: string,
    object: { objectId: string } | { value: string | number | boolean },
    validity: { validFrom?: string | null; validTo?: string | null } = {},
  ) => {
    const c = {
      id: id(),
      subjectId,
      predicate,
      ...object,
      confidence: 0.8,
      explanation: "test",
      validFrom: validity.validFrom ?? null,
      validTo: validity.validTo ?? null,
    };
    add("claim.added", c);
    return c.id;
  };
  const evidence = () => {
    const sha = "ab".repeat(32);
    const ev = {
      id: id(),
      sha256: sha,
      mime: "application/json",
      size: 2,
      blobRef: `blobs/ab/${sha}`,
      fetchedAt: T0,
      request: { method: "LOCAL", url: "local://fixture", headers: {} },
      transformId: "tr-dns",
      version: "1",
    };
    add("evidence.stored", ev);
    return ev.id;
  };
  /** The observation id is returned so tests can assert per-observation fidelity. */
  const observe = (
    target: { entityId: string } | { claimId: string },
    kind: "positive" | "negative" | "error",
    evidenceId: string,
    at: string,
  ) => {
    const obs = { id: id(), ...target, transformId: "tr-dns", evidenceId, observedAt: at, kind };
    add("observation.added", obs);
    return obs.id;
  };
  return { ledger, add, id, entity, claim, evidence, observe };
}

describe("P4-006 — bitemporal projections (T-TIME)", () => {
  it("T-TIME-001: a claim backed by multiple observations keeps every one — id, evidence, time, kind — on the edge AND the literal attribute, sorted by moment", () => {
    const f = fixture();
    const a = f.entity("person", "a");
    const b = f.entity("person", "b");
    const rel = f.claim(a, "knows", { objectId: b });
    const lit = f.claim(a, "job", { value: "مهندس" });
    const ev1 = f.evidence();
    const ev2 = f.evidence();
    const ev3 = f.evidence();
    const ev4 = f.evidence();
    // three observations on the relation claim: mixed offsets, mixed kinds — none may be lost or collapsed
    const obs1 = f.observe({ claimId: rel }, "positive", ev1, "2026-03-01T10:00:00Z"); // 10:00Z
    const obs2 = f.observe({ claimId: rel }, "positive", ev2, "2026-03-01T09:00:00-05:00"); // 14:00Z
    const obs3 = f.observe({ claimId: rel }, "negative", ev3, "2026-03-01T08:00:00Z"); // 08:00Z
    const obs4 = f.observe({ claimId: lit }, "positive", ev4, "2026-03-01T06:30:00+02:00"); // 04:30Z
    const p = project(f.ledger.entries());

    const edge = p.graph.edges.find((e) => e.id === rel);
    expect(edge).toBeDefined();
    const eo = (edge?.observations ?? []) as ClaimObservation[];
    expect(eo).toHaveLength(3); // every observation is there — no collapsing to a single timestamp
    expect(eo.map((o) => o.observationId)).toEqual([obs3, obs1, obs2]); // by MOMENT: 08:00Z, 10:00Z, 14:00Z
    expect(eo.map((o) => o.evidenceId)).toEqual([ev3, ev1, ev2]); // each keeps its own evidence
    expect(eo.map((o) => o.kind)).toEqual(["negative", "positive", "positive"]); // kinds preserved
    expect(eo[0]?.observedAt).toBe("2026-03-01T08:00:00Z"); // the original string, honest to its source

    const attr = p.graph.nodes.find((n) => n.id === a)?.attributes.find((x) => x.claimId === lit);
    expect(attr).toBeDefined();
    const ao = (attr?.observations ?? []) as ClaimObservation[];
    expect(ao).toHaveLength(1);
    expect(ao[0]).toMatchObject({ observationId: obs4, evidenceId: ev4, observedAt: "2026-03-01T06:30:00+02:00", kind: "positive" });
  });

  it("T-TIME-002: a literal claim carries its validity interval — the node attribute shows validFrom/validTo, not only relation edges", () => {
    const f = fixture();
    const a = f.entity("person", "a");
    const lit = f.claim(a, "job", { value: "مهندس" }, { validFrom: "2019-01-01T00:00:00Z", validTo: "2019-12-31T23:59:59Z" });
    const p = project(f.ledger.entries());
    const attr = p.graph.nodes.find((n) => n.id === a)?.attributes.find((x) => x.claimId === lit);
    expect(attr).toBeDefined();
    expect(attr?.validFrom).toBe("2019-01-01T00:00:00Z");
    expect(attr?.validTo).toBe("2019-12-31T23:59:59Z");
  });

  it("T-TIME-003: validity time, observation time and ledger time are three different clocks — none leaks into another (existing validity exposure, verified alongside the new observation list)", () => {
    const f = fixture();
    const a = f.entity("person", "a");
    const b = f.entity("person", "b");
    // three DIFFERENT clocks: validity in 2019, observed in March 2026, ledger appended at T0 (2026-10-10)
    const rel = f.claim(a, "knows", { objectId: b }, { validFrom: "2019-06-01T00:00:00Z", validTo: "2020-06-01T00:00:00Z" });
    const ev = f.evidence();
    const obs = f.observe({ claimId: rel }, "positive", ev, "2026-03-01T10:00:00Z");
    const p = project(f.ledger.entries());
    const edge = p.graph.edges.find((e) => e.id === rel);
    expect(edge).toBeDefined();
    // the claim's validity — not the observation time, not the ledger time
    expect(edge?.validFrom).toBe("2019-06-01T00:00:00Z");
    expect(edge?.validTo).toBe("2020-06-01T00:00:00Z");
    // the observation's own time — not the claim's validity, not the ledger time (T0 = 2026-10-10)
    expect((edge?.observations as ClaimObservation[])[0]).toMatchObject({
      observationId: obs,
      observedAt: "2026-03-01T10:00:00Z",
    });
    // the ledger append time is a THIRD clock: the observation's own entry was appended at a
    // T0-based time, distinct from both its observedAt (March 2026) and the claim's validity (2019)
    const entry = f.ledger.entries().find((e) => e.kind === "observation.added");
    expect(entry?.at).toBe("2026-10-10T08:00:05.000Z"); // T0 + 5 advances of 1s: entity, entity, claim, evidence, observation
  });

  it("T-TIME-004: first/last observed and coverage lastAt follow MOMENT order with mixed timezone offsets — not text order (latent text-sort defect)", () => {
    const f = fixture();
    const a = f.entity("person", "a");
    const ev1 = f.evidence();
    const ev2 = f.evidence();
    // 12:00Z and 10:00-05:00 (= 15:00Z): TEXT order says "10:00:00-05:00" < "12:00:00Z",
    // MOMENT order says 12:00Z came first and 15:00Z came last.
    f.observe({ entityId: a }, "positive", ev1, "2026-01-01T12:00:00Z");
    f.observe({ entityId: a }, "negative", ev2, "2026-01-01T10:00:00-05:00");
    const p = project(f.ledger.entries());

    const row = p.table.find((r) => r.id === a);
    expect(row).toBeDefined();
    expect(row?.firstObservedAt).toBe("2026-01-01T12:00:00Z"); // the EARLIER moment
    expect(row?.lastObservedAt).toBe("2026-01-01T10:00:00-05:00"); // the LATER moment (15:00Z)

    const cell = p.coverage.cells.find((c) => c.entityId === a);
    expect(cell).toBeDefined();
    expect(cell?.lastAt).toBe("2026-01-01T10:00:00-05:00"); // the LATER moment
    expect(cell?.last).toBe("negative"); // the observation that actually came last in time
  });

  it("T-TIME-004b: sub-millisecond fractional seconds keep TRUE moment order — the schema accepts them and Date.parse collapses them (red before the comparator fix)", () => {
    const f = fixture();
    const a = f.entity("person", "a");
    const b = f.entity("person", "b");
    const rel = f.claim(a, "knows", { objectId: b });
    const ev1 = f.evidence();
    const ev2 = f.evidence();
    // .0009Z is the LATER moment but appended FIRST; .0001Z is EARLIER but appended last.
    // Date.parse truncates both to the same millisecond — the tie must NOT fall to the id.
    const obsLate = f.observe({ claimId: rel }, "error", ev1, "2026-01-01T00:00:00.0009Z");
    const obsEarly = f.observe({ claimId: rel }, "negative", ev2, "2026-01-01T00:00:00.0001Z");
    // entity-targeted observations with the same sub-ms pair: first/lastObservedAt and coverage read these
    f.observe({ entityId: a }, "error", ev1, "2026-01-01T00:00:00.0009Z");
    f.observe({ entityId: a }, "negative", ev2, "2026-01-01T00:00:00.0001Z");
    const p = project(f.ledger.entries());

    const edge = p.graph.edges.find((e) => e.id === rel);
    expect(edge).toBeDefined();
    const eo = (edge?.observations ?? []) as ClaimObservation[];
    expect(eo.map((o) => o.observationId)).toEqual([obsEarly, obsLate]); // TRUE moment order

    const row = p.table.find((r) => r.id === a);
    expect(row?.firstObservedAt).toBe("2026-01-01T00:00:00.0001Z");
    expect(row?.lastObservedAt).toBe("2026-01-01T00:00:00.0009Z");

    const cell = p.coverage.cells.find((c) => c.entityId === a);
    expect(cell?.lastAt).toBe("2026-01-01T00:00:00.0009Z");
    expect(cell?.last).toBe("error");
  });

  it("T-TIME-001b (supplementary, existing behavior): equal moments in different representations tie-break by observationId, not append order — and error kind is served like any other", () => {
    const f = fixture();
    const a = f.entity("person", "a");
    const b = f.entity("person", "b");
    const rel = f.claim(a, "knows", { objectId: b });
    const ev = f.evidence();
    // 12:00Z and 07:00-05:00 are the SAME moment; ids crafted so id order opposes append order
    const late = {
      id: "7" + "Z".repeat(25),
      claimId: rel,
      transformId: "tr-dns",
      evidenceId: ev,
      observedAt: "2026-01-01T12:00:00Z",
      kind: "positive" as const,
    };
    const early = {
      id: "0".repeat(26),
      claimId: rel,
      transformId: "tr-dns",
      evidenceId: ev,
      observedAt: "2026-01-01T07:00:00-05:00",
      kind: "error" as const,
    };
    f.add("observation.added", late);
    f.add("observation.added", early);
    const p = project(f.ledger.entries());
    const eo = (p.graph.edges.find((e) => e.id === rel)?.observations ?? []) as ClaimObservation[];
    expect(eo.map((o) => o.observationId)).toEqual([early.id, late.id]); // id tie-break, not append order
    expect(eo.map((o) => o.kind)).toEqual(["error", "positive"]); // error kind served like any other
  });

  it("T-TIME-005: a snapshot at an earlier seq never leaks a later-appended observation even when its observedAt is old (existing upTo behavior, verified)", () => {
    const f = fixture();
    const a = f.entity("person", "a");
    const b = f.entity("person", "b");
    const rel = f.claim(a, "knows", { objectId: b });
    const ev = f.evidence();
    // the observation is APPENDED late in the chain but its observedAt is old (2019).
    // seqs start at 0: the observation's own seq is exactly `before` (the count before it was appended),
    // so the snapshot BEFORE it is upTo: before-1, and the snapshot WITH it is upTo: before.
    const before = f.ledger.entries().length;
    const obs = f.observe({ claimId: rel }, "positive", ev, "2019-01-01T00:00:00Z");
    const entries = f.ledger.entries();

    const earlier = project(entries, { upTo: before - 1 });
    expect(earlier.graph.edges.find((e) => e.id === rel)?.observations ?? []).toHaveLength(0);
    expect(earlier.counts.observations).toBe(0); // nothing leaks into the snapshot before its seq

    const atSeq = project(entries, { upTo: before });
    const eo = (atSeq.graph.edges.find((e) => e.id === rel)?.observations ?? []) as ClaimObservation[];
    expect(eo.map((o) => o.observationId)).toEqual([obs]); // present once its seq is included
    expect(eo[0]?.observedAt).toBe("2019-01-01T00:00:00Z"); // and its own old time is preserved honestly
  });
});
