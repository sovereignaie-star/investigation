import { manualClock, seededRandom, ulidFactory } from "@ir/core";
import { describe, expect, it } from "vitest";
import { Ledger, type Entry } from "../index.ts";
import { project, projectionHash, Projector, view } from "./index.ts";

const T0 = "2026-10-10T08:00:00.000Z";

/**
 * D-053: heavy tests carry an explicit timeout. 30 s is the ceiling (owner directive); the slowest CI run measured
 * 7.4 s, so a failure here means a real slowdown, not a busy runner hitting Vitest's 5 s default.
 */
const HEAVY_MS = 30_000;

function fixture(seed = 1) {
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
  const claim = (subjectId: string, predicate: string, object: { objectId: string } | { value: string | number | boolean }) => {
    const c = { id: id(), subjectId, predicate, ...object, confidence: 0.8, explanation: "test" };
    add("claim.added", c);
    return c.id;
  };
  const evidence = (transformId = "tr-dns") => {
    const sha = "ab".repeat(32);
    const ev = {
      id: id(),
      sha256: sha,
      mime: "application/json",
      size: 2,
      blobRef: `blobs/ab/${sha}`,
      fetchedAt: T0,
      request: { method: "LOCAL", url: "local://fixture", headers: {} },
      transformId,
      version: "1",
    };
    add("evidence.stored", ev);
    return ev.id;
  };
  const observe = (
    target: { entityId: string } | { claimId: string },
    kind: "positive" | "negative" | "error",
    evidenceId: string,
    transformId = "tr-dns",
    at = T0,
  ) => {
    add("observation.added", { id: id(), ...target, transformId, evidenceId, observedAt: at, kind });
  };
  const merge = (entityIds: string[], survivorId: string) => {
    const m = { id: id(), entityIds, survivorId, reasons: ["same person per test"], decidedBy: "tester", decidedAt: T0, reverted: false };
    add("merge.decided", m);
    return m.id;
  };
  return { ledger, add, id, entity, claim, evidence, observe, merge };
}

describe("projections (P1-016)", () => {
  it("an empty chain projects to empty views", () => {
    const p = project([]);
    expect(p.seq).toBe(-1);
    expect(p.graph).toEqual({ nodes: [], edges: [] });
    expect(p.table).toEqual([]);
    expect(p.coverage).toEqual({ cells: [], transforms: [], untouched: [] });
  });

  it("graph, table and coverage from entities, claims, evidence and observations", () => {
    const f = fixture();
    f.add("case.created", { note: "ignored by projections" });
    const email = f.entity("email", "a@example.com");
    const domain = f.entity("domain", "example.com");
    const ip = f.entity("ipv4", "192.0.2.7");
    const c1 = f.claim(email, "email.domain", { objectId: domain });
    f.claim(domain, "dns.a", { objectId: ip });
    f.claim(domain, "whois.registrar", { value: "Example Registrar" });
    const ev = f.evidence();
    f.observe({ entityId: domain }, "positive", ev);
    f.observe({ entityId: domain }, "negative", ev, "tr-whois", "2026-10-10T09:00:00.000Z");
    f.observe({ claimId: c1 }, "positive", ev, "tr-mx");
    f.observe({ entityId: email }, "error", ev, "tr-breach");
    const p = project(f.ledger.entries());

    expect(p.counts).toMatchObject({ entities: 3, nodes: 3, claims: 3, edges: 2, observations: 4, evidence: 1, merges: 0 });
    const d = p.graph.nodes.find((n) => n.id === domain);
    expect(d?.attributes).toEqual([expect.objectContaining({ predicate: "whois.registrar", value: "Example Registrar" })]);
    expect(d?.observations).toEqual({ positive: 1, negative: 1, error: 0 });
    expect(d?.evidenceIds).toEqual([ev]);
    expect(p.graph.edges.find((e) => e.id === c1)).toMatchObject({ source: email, target: domain, evidenceIds: [ev] });

    const row = p.table.find((r) => r.id === domain);
    expect(row).toMatchObject({ claims: 3, evidence: 1, firstObservedAt: T0, lastObservedAt: "2026-10-10T09:00:00.000Z" });

    // D3: "searched, found nothing" is coverage too; an observation on a claim counts for its subject
    expect(p.coverage.cells.find((c) => c.entityId === domain && c.transformId === "tr-whois")).toMatchObject({
      negative: 1,
      last: "negative",
    });
    expect(p.coverage.cells.find((c) => c.entityId === email && c.transformId === "tr-mx")).toMatchObject({ positive: 1 });
    expect(p.coverage.untouched).toEqual([ip]);
    expect(p.coverage.transforms).toEqual(["tr-breach", "tr-dns", "tr-mx", "tr-whois"]);
    expect(p.issues).toEqual([]);
  });

  it("D-020: two entities with one canonical key are one node; claims on either land on it", () => {
    const f = fixture();
    const a = f.entity("email", "a@example.com");
    const a2 = f.entity("email", "a@example.com", "duplicate");
    const b = f.entity("domain", "example.com");
    f.claim(a2, "email.domain", { objectId: b });
    const p = project(f.ledger.entries());
    expect(p.graph.nodes).toHaveLength(2);
    expect(p.graph.nodes.find((n) => n.id === a)?.aliases).toEqual([a2]);
    expect(p.graph.edges[0]).toMatchObject({ source: a, target: b });
  });

  it("merges move edges to the survivor, drop internal loops from the graph, and revert cleanly", () => {
    const f = fixture();
    const a = f.entity("username", "ali");
    const b = f.entity("username", "ali_1");
    const c = f.entity("domain", "example.com");
    f.claim(b, "uses", { objectId: c });
    f.claim(a, "same.as", { objectId: b });
    const before = project(f.ledger.entries());
    const m = f.merge([a, b], a);
    const merged = project(f.ledger.entries());
    expect(merged.graph.nodes.map((n) => n.id).sort()).toEqual([a, c].sort());
    expect(merged.graph.nodes.find((n) => n.id === a)?.aliases).toEqual([b]);
    expect(merged.graph.edges).toEqual([expect.objectContaining({ source: a, target: c, predicate: "uses" })]);
    expect(merged.table.find((r) => r.id === a)?.claims).toBe(2); // the internal claim stays visible in the table
    f.add("merge.reverted", { mergeId: m });
    const reverted = project(f.ledger.entries());
    expect(reverted.graph).toEqual(before.graph);
    expect(reverted.counts.merges).toBe(0);
  });

  it("chained merges resolve to the final survivor", () => {
    const f = fixture();
    const [a, b, c] = [f.entity("username", "a1"), f.entity("username", "b1"), f.entity("username", "c1")];
    f.merge([b, c], b);
    f.merge([a, b], a);
    const n = project(f.ledger.entries()).graph.nodes;
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ id: a, aliases: [b, c].sort() });
  });

  it("bad payloads and references become issues, never exceptions", () => {
    const f = fixture();
    const a = f.entity("email", "a@example.com");
    f.add("entity.added", { id: "not-a-ulid" });
    f.add("entity.added", { id: a, type: "email", canonicalKey: "email:a@example.com", labels: { en: "again" }, props: {} });
    f.claim(a, "knows", { objectId: f.id() });
    f.observe({ entityId: a }, "positive", f.id());
    f.add("merge.reverted", { mergeId: "nope" });
    const p = project(f.ledger.entries());
    expect(p.issues.map((i) => i.code)).toEqual(["invalid-payload", "duplicate-id", "unknown-entity", "unknown-evidence", "unknown-merge"]);
    expect(p.graph.nodes).toHaveLength(1);
    expect(p.graph.edges).toHaveLength(0);
  });

  it("snapshot(seq): upTo gives the view of the chain prefix (5.15)", () => {
    const f = fixture();
    const a = f.entity("email", "a@example.com");
    const cut = f.ledger.length - 1;
    f.claim(a, "x", { value: 1 });
    const snap = project(f.ledger.entries(), { upTo: cut });
    expect(snap.seq).toBe(cut);
    expect(projectionHash(snap)).toBe(projectionHash(project(f.ledger.entries().slice(0, cut + 1))));
    expect(projectionHash(snap)).not.toBe(projectionHash(project(f.ledger.entries())));
  });

  it("rejects out-of-order application", () => {
    const f = fixture();
    f.entity("email", "a@example.com");
    f.entity("email", "b@example.com");
    const [e0, e1] = f.ledger.entries() as Entry[];
    expect(() => new Projector().apply(e1 as Entry).apply(e0 as Entry)).toThrow(/out of order/);
  });

  it(
    "acceptance: a live projection equals a rebuild from the chain after every one of 600 random events",
    () => {
      const f = fixture(42);
      const rnd = seededRandom(7);
      const r = (n: number) => (rnd(new Uint8Array(4)).reduce((a, b) => a * 256 + b, 0) >>> 0) % n;
      const ents: string[] = [],
        claims: string[] = [],
        evs: string[] = [],
        merges: string[] = [];
      const live = new Projector();
      let checked = 0;
      const pickE = () => ents[r(ents.length)] as string;
      const actions: (() => void)[] = [
        () => void ents.push(f.entity(["email", "domain", "ipv4", "username"][r(4)] as string, `v${r(40)}`)),
        () => void claims.push(f.claim(pickE(), "rel", r(3) ? { objectId: pickE() } : { value: r(100) })),
        () => void evs.push(f.evidence(`tr-${r(4)}`)),
        () => {
          if (!evs.length) return void evs.push(f.evidence());
          const t = claims.length && r(4) === 0 ? { claimId: claims[r(claims.length)] as string } : { entityId: pickE() };
          f.observe(t, (["positive", "negative", "error"] as const)[r(3)] ?? "positive", evs[r(evs.length)] as string, `tr-${r(4)}`);
        },
        () => {
          const [x, y] = [pickE(), pickE()];
          if (x !== y) merges.push(f.merge([x, y], x));
        },
        () =>
          merges.length ? void f.add("merge.reverted", { mergeId: merges[r(merges.length)] }) : void f.add("note.added", { text: "n" }),
      ];
      const weights = [0, 0, 0, 1, 1, 2, 3, 3, 4, 5]; // entity 30%, claim 20%, evidence 10%, observation 20%, merge 10%, revert 10%
      for (let i = 0; i < 600; i++) {
        const before = f.ledger.length;
        (actions[ents.length < 2 ? 0 : (weights[r(10)] ?? 0)] as () => void)();
        for (const e of f.ledger.entries().slice(before)) live.apply(e);
        expect(projectionHash(view(live))).toBe(projectionHash(project(f.ledger.entries())));
        checked++;
      }
      expect(checked).toBe(600);
      expect(view(live).counts.merges).toBeGreaterThan(0);
    },
    HEAVY_MS,
  );

  it("D-051: a merge that names an entity before it is added stays equal to a rebuild after a mid-way view", () => {
    const f = fixture();
    const a = f.entity("email", "a@example.com");
    const b = f.entity("email", "b@example.com");
    const late = f.id(); // named by the merge first, added later under a's canonical key
    f.merge([late, b], b);
    const live = new Projector().applyAll(f.ledger.entries());
    view(live); // a view reads (and used to cache) the merge index before the late entity exists
    f.add("entity.added", { id: late, type: "email", canonicalKey: "email:a@example.com", labels: { en: "late" }, props: {} });
    live.apply(f.ledger.entries().at(-1) as Entry);
    const rebuilt = project(f.ledger.entries());
    expect(projectionHash(view(live))).toBe(projectionHash(rebuilt));
    // late is an alias of a, so the merge joins a's node into b's
    expect(rebuilt.graph.nodes).toEqual([expect.objectContaining({ id: b, aliases: [a, late].sort() })]);
  });

  it(
    "D-051: live equals rebuild after every one of 600 random events when merges name ids before they exist",
    () => {
      const f = fixture(9);
      const rnd = seededRandom(11);
      const r = (n: number) => (rnd(new Uint8Array(4)).reduce((x, y) => x * 256 + y, 0) >>> 0) % n;
      const pool = Array.from({ length: 120 }, () => f.id());
      let next = 0;
      const merges: string[] = [];
      const live = new Projector();
      for (let i = 0; i < 600; i++) {
        const before = f.ledger.length;
        const k = r(10);
        if (k < 4 && next < pool.length) {
          const key = `username:u${r(15)}`; // few keys: many later ids become aliases
          f.add("entity.added", { id: pool[next++], type: "username", canonicalKey: key, labels: { en: key }, props: {} });
        } else if (k < 8) {
          const [x, y] = [pool[r(pool.length)] as string, pool[r(pool.length)] as string]; // may not exist yet
          if (x !== y) merges.push(f.merge([x, y], r(2) ? x : y));
        } else if (merges.length) f.add("merge.reverted", { mergeId: merges[r(merges.length)] });
        for (const e of f.ledger.entries().slice(before)) live.apply(e);
        if (r(3) === 0) view(live); // views in between must not change what later entries mean
        expect(projectionHash(view(live))).toBe(projectionHash(project(f.ledger.entries())));
      }
      expect(view(live).counts.merges).toBeGreaterThan(0);
    },
    HEAVY_MS,
  );

  it(
    "acceptance P1-022: 100,000 nodes project in under 2 s, and 5,000 chained merges stay near linear",
    () => {
      const clock = manualClock(T0);
      const id = ulidFactory(clock, seededRandom(5));
      const entries: Entry[] = [];
      const add = (kind: Entry["kind"], payload: unknown) => entries.push({ seq: entries.length, kind, payload } as unknown as Entry); // projections read seq, kind and payload only
      const ids: string[] = [];
      for (let i = 0; i < 100_000; i++) {
        ids.push(id());
        add("entity.added", { id: ids[i], type: "email", canonicalKey: `email:u${i}@example.com`, labels: { en: `u${i}` }, props: {} });
      }
      let t = performance.now();
      const p = new Projector().applyAll(entries);
      const v = view(p);
      const nodesMs = performance.now() - t;
      expect(v.counts.nodes).toBe(100_000);
      expect(p.issues).toEqual([]);
      expect(nodesMs).toBeLessThan(2000);

      // each merge joins the previous survivor into a new one: a chain 5,000 deep, resolved after every merge
      const from = entries.length;
      for (let i = 1; i <= 5000; i++)
        add("merge.decided", {
          id: id(),
          entityIds: [ids[i - 1], ids[i]],
          survivorId: ids[i],
          reasons: ["chain"],
          decidedBy: "t",
          decidedAt: T0,
          reverted: false,
        });
      t = performance.now();
      for (const e of entries.slice(from)) {
        p.apply(e);
        p.resolve(ids[0] as string);
      }
      const mergeMs = performance.now() - t;
      expect(p.resolve(ids[0] as string)).toBe(ids[5000]);
      expect(mergeMs).toBeLessThan(2000);
      expect(projectionHash(view(p))).toBe(projectionHash(project(entries)));
    },
    HEAVY_MS,
  );

  it("is deterministic: the same chain always hashes the same", () => {
    const build = () => {
      const f = fixture(3);
      const a = f.entity("email", "a@example.com");
      f.claim(a, "x", { value: true });
      return projectionHash(project(f.ledger.entries()));
    };
    expect(build()).toBe(build());
  });
});
