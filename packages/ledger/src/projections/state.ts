import { Claim, Entity, Evidence, MergeDecision, Observation } from "@ir/schema";
import { z } from "zod/v4";
import type { Entry } from "../ledger.ts";

/**
 * Projection state (5.1 "the ledger is the truth", P1-016). A pure reducer over ledger entries with readable payloads:
 * the graph, the table and the coverage map are all derived from this state, so a projection kept live while
 * appending and one rebuilt from the stored chain are the same function of the same entries.
 * Invalid or conflicting payloads never throw; they become `issues` that point at the entry's seq.
 */
export interface Issue {
  seq: number;
  kind: string;
  code: "invalid-payload" | "duplicate-id" | "unknown-merge" | "unknown-entity" | "unknown-claim" | "unknown-evidence";
  message: string;
}

export interface StoredEntity extends Entity {
  seq: number;
}
export interface StoredClaim extends Claim {
  seq: number;
}
export interface StoredObservation extends Observation {
  seq: number;
}

const MergeReverted = z.object({ mergeId: z.string().min(1) });

export class Projector {
  /** Last applied seq (-1 before any entry). */
  seq = -1;
  readonly entities = new Map<string, StoredEntity>();
  /** canonicalKey -> first entity id with that key: one node per real-world identifier (D-020). */
  readonly byKey = new Map<string, string>();
  /** Later ids for an already known canonicalKey -> the first id. */
  readonly keyAlias = new Map<string, string>();
  readonly claims = new Map<string, StoredClaim>();
  readonly observations: StoredObservation[] = [];
  readonly evidence = new Map<string, Evidence & { seq: number }>();
  /** Merge decisions in ledger order; `reverted` is set by merge.reverted. */
  readonly merges = new Map<string, MergeDecision & { seq: number }>();
  readonly issues: Issue[] = [];
  notes = 0;
  /**
   * Merge index (P1-022, D-034, D-051): union-find over node ids with path compression, kept in step with the chain.
   * `merge.decided` is a union and `resolve` a find, amortised O(log n) each (near constant in practice). It is rebuilt from `merges` in seq order only when
   * an earlier union is no longer valid: a merge is reverted, or an entity a merge refers to is added later under a
   * canonical key that already has a node (its alias changes what the merge joins). A rebuild applies exactly the
   * same unions in the same order, so the live index, a rebuild and a fresh projection of the chain always agree.
   */
  readonly #parent = new Map<string, string>();
  /** Entity ids named by any merge decision: only these can make an earlier union stale. */
  readonly #mergeRefs = new Set<string>();
  #stale = false;

  apply(entry: Entry): this {
    if (entry.seq <= this.seq) throw new Error(`projection out of order: seq ${entry.seq} after ${this.seq}`);
    this.seq = entry.seq;
    const handler = HANDLERS[entry.kind];
    if (handler) handler(this, entry);
    return this;
  }

  applyAll(entries: Iterable<Entry>): this {
    for (const e of entries) this.apply(e);
    return this;
  }

  issue(entry: Entry, code: Issue["code"], message: string): void {
    this.issues.push({ seq: entry.seq, kind: entry.kind, code, message });
  }

  /** Records a new merge in the index (called after it is stored in `merges`). */
  mergeAdded(m: MergeDecision): void {
    this.#mergeRefs.add(m.survivorId);
    for (const id of m.entityIds) this.#mergeRefs.add(id);
    if (!this.#stale) this.#union(m);
  }

  /** An earlier union no longer holds (revert): the index is rebuilt on the next `resolve`. */
  invalidateMerges(): void {
    this.#stale = true;
  }

  /** A new entity id became an alias of an existing node; stale only if a merge already named that id. */
  aliasAdded(id: string): void {
    if (this.#mergeRefs.has(id)) this.#stale = true;
  }

  /** The node id an entity id is shown under: canonical-key duplicates, then active merges (survivor wins). */
  resolve(id: string): string {
    if (this.#stale) this.#rebuild();
    return this.#find(this.keyAlias.get(id) ?? id);
  }

  #find(x: string): string {
    let r = x;
    for (let up = this.#parent.get(r); up !== undefined && up !== r; up = this.#parent.get(r)) r = up;
    // path compression: every id on the walk now points at the root
    for (let c = x, up = this.#parent.get(c); up !== undefined && up !== r; up = this.#parent.get(c)) {
      this.#parent.set(c, r);
      c = up;
    }
    return r;
  }

  #union(m: MergeDecision): void {
    const survivor = this.#find(this.keyAlias.get(m.survivorId) ?? m.survivorId);
    for (const id of m.entityIds) {
      const r = this.#find(this.keyAlias.get(id) ?? id);
      if (r !== survivor) this.#parent.set(r, survivor);
    }
  }

  #rebuild(): void {
    this.#parent.clear();
    this.#stale = false;
    // `merges` keeps insertion order, which is ledger (seq) order because entries are applied in order
    for (const m of this.merges.values()) if (!m.reverted) this.#union(m);
  }
}

type Handler = (p: Projector, e: Entry) => void;

function parsed<T>(p: Projector, e: Entry, schema: z.ZodType<T>): T | null {
  const r = schema.safeParse(e.payload);
  if (r.success) return r.data;
  p.issue(e, "invalid-payload", r.error.issues.map((i) => `${i.path.join(".") || "payload"}: ${i.message}`).join("; "));
  return null;
}

const HANDLERS: Partial<Record<Entry["kind"], Handler>> = {
  "entity.added": (p, e) => {
    const ent = parsed(p, e, Entity);
    if (!ent) return;
    if (p.entities.has(ent.id)) return p.issue(e, "duplicate-id", `entity ${ent.id} already added`);
    p.entities.set(ent.id, { ...ent, seq: e.seq });
    const first = p.byKey.get(ent.canonicalKey);
    if (first) {
      p.keyAlias.set(ent.id, first);
      p.aliasAdded(ent.id);
    } else p.byKey.set(ent.canonicalKey, ent.id);
  },
  "claim.added": (p, e) => {
    const c = parsed(p, e, Claim);
    if (!c) return;
    if (p.claims.has(c.id)) return p.issue(e, "duplicate-id", `claim ${c.id} already added`);
    for (const id of [c.subjectId, c.objectId])
      if (id && !p.entities.has(id)) p.issue(e, "unknown-entity", `claim ${c.id} refers to ${id}`);
    p.claims.set(c.id, { ...c, seq: e.seq });
  },
  "observation.added": (p, e) => {
    const o = parsed(p, e, Observation);
    if (!o) return;
    if (o.entityId && !p.entities.has(o.entityId)) p.issue(e, "unknown-entity", `observation ${o.id} refers to ${o.entityId}`);
    if (o.claimId && !p.claims.has(o.claimId)) p.issue(e, "unknown-claim", `observation ${o.id} refers to ${o.claimId}`);
    if (!p.evidence.has(o.evidenceId)) p.issue(e, "unknown-evidence", `observation ${o.id} cites ${o.evidenceId}`);
    p.observations.push({ ...o, seq: e.seq });
  },
  "evidence.stored": (p, e) => {
    const ev = parsed(p, e, Evidence);
    if (!ev) return;
    if (p.evidence.has(ev.id)) return p.issue(e, "duplicate-id", `evidence ${ev.id} already stored`);
    p.evidence.set(ev.id, { ...ev, seq: e.seq });
  },
  "merge.decided": (p, e) => {
    const m = parsed(p, e, MergeDecision);
    if (!m) return;
    if (p.merges.has(m.id)) return p.issue(e, "duplicate-id", `merge ${m.id} already decided`);
    for (const id of m.entityIds) if (!p.entities.has(id)) p.issue(e, "unknown-entity", `merge ${m.id} refers to ${id}`);
    p.merges.set(m.id, { ...m, reverted: false, seq: e.seq });
    p.mergeAdded(m);
  },
  "merge.reverted": (p, e) => {
    const r = parsed(p, e, MergeReverted);
    if (!r) return;
    const m = p.merges.get(r.mergeId);
    if (!m) return p.issue(e, "unknown-merge", `merge ${r.mergeId} not found`);
    m.reverted = true;
    p.invalidateMerges();
  },
  "note.added": (p) => {
    p.notes++;
  },
};
