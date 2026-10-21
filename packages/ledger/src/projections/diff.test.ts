import { manualClock, seededRandom, ulidFactory } from "@ir/core";
import { describe, expect, it } from "vitest";
import { Ledger } from "../index.ts";
import { project } from "./index.ts";
import { diffProjections } from "./diff.ts";

/**
 * P4-008 — اللقطات والمقارنة (T-TIME-006..010, ROADMAP 5.15/UC-09).
 *
 * التصميم (5.15): اللقطة = إسقاط السجل حتى تسلسل معين (project upTo — قائم من P1-016)،
 * والفرق = مقارنة إسقاطين بالمفاتيح القانونية: الكيانات بمفتاحها القانوني
 * (canonicalKey) والادعاءات بمعرفها. الحكم على «تغيّر» الكيان: اختلاف المحتوى
 * المُقدَّم للعقدة (التسميات/الخصائص/الأسماء المستعارة/الصفات)؛ و«تغيّر» الادعاء:
 * اختلاف محتواه المُقدَّم (المسند/القيمة/الصلاحية/نافذة الحدوث) — تراكم الملاحظات
 * (evidenceIds/observations) ليس تغيّراً للمحتوى بل تورّع أدلة، وهو خارج تعريف
 * «التغيّر» هنا وموثق بذلك.
 *
 * صادق الأدلة: T-TIME-007..010 حمراء — الوحدة `diff.ts` غير موجودة قبل التنفيذ
 * (فشل تحميل الوحدة المفقودة، قاعدة J-1) — والتوثيق في WORKLOG قبل أي تنفيذ.
 * T-TIME-006 تتحقق من سلوك قائم (upTo من P1-016) — موسومة بذلك في متنها، وليست
 * دليلاً أحمر أصلياً.
 */

const T0 = "2026-10-10T08:00:00.000Z";

/** The seq of the last entry — the fixture chain is never empty, and the check says so. */
function lastSeq(entries: readonly { seq: number }[]): number {
  const last = entries.at(-1);
  if (last === undefined) throw new Error("fixture chain must not be empty");
  return last.seq;
}

function fixture() {
  const clock = manualClock(T0);
  const id = ulidFactory(clock, seededRandom(7));
  const ledger = new Ledger({ actor: "tester", clock });
  const add = (kind: Parameters<Ledger["append"]>[0], payload: unknown) => {
    clock.advance(1000);
    return ledger.append(kind, payload);
  };
  const entity = (type: string, value: string) => {
    const e = {
      id: id(),
      type,
      canonicalKey: `${type}:${value}`,
      labels: { en: value },
      props: {},
    };
    add("entity.added", e);
    return e.id;
  };
  const relation = (subjectId: string, predicate: string, objectId: string) => {
    const claimId = id();
    add("claim.added", {
      id: claimId,
      subjectId,
      predicate,
      objectId,
      validFrom: null,
      validTo: null,
      occurredFrom: null,
      occurredTo: null,
      confidence: 0.8,
      explanation: "test fixture claim",
    });
    return claimId;
  };
  const attribute = (subjectId: string, predicate: string, value: string) => {
    const claimId = id();
    add("claim.added", {
      id: claimId,
      subjectId,
      predicate,
      value,
      validFrom: null,
      validTo: null,
      occurredFrom: null,
      occurredTo: null,
      confidence: 0.8,
      explanation: "test fixture attribute",
    });
    return claimId;
  };
  return { ledger, id, entity, relation, attribute, add };
}

/** The case at the heart of UC-09: two snapshots of one case, diffed by legal keys. */
function caseFixture() {
  const f = fixture();
  const alice = f.entity("person", "alice");
  const bob = f.entity("person", "bob");
  const knows = f.relation(alice, "knows", bob);
  const name = f.attribute(alice, "name", "Alice");
  const seqA = lastSeq(f.ledger.entries()); // لقطة أولى: أليس وبوب وادعاءان
  const dave = f.entity("person", "dave");
  const daveName = f.attribute(dave, "name", "Dave");
  // دمج بوب في أليس: عقدة بوب تختفي كعقدة، وأليس تكسب اسماً مستعاراً (تغيّر)
  const merge = f.add("merge.decided", {
    id: f.id(),
    entityIds: [alice, bob],
    survivorId: alice,
    reasons: ["same person per analyst review"],
    decidedBy: "analyst",
    decidedAt: T0,
    reverted: false,
  });
  const seqB = lastSeq(f.ledger.entries()); // لقطة ثانية: ديف أُضيف، بوب دُمج، ادعاء جديد
  return { f, alice, bob, dave, knows, name, daveName, merge, seqA, seqB };
}

describe("P4-008 snapshot at seq (T-TIME-006 — verification of existing upTo behavior, not an original red)", () => {
  it("T-TIME-006: a snapshot at seq excludes every later entry", () => {
    const c = caseFixture();
    const entries = [...c.f.ledger.entries()];
    const atA = project(entries, { upTo: c.seqA });
    const atB = project(entries, { upTo: c.seqB });
    expect(atA.seq).toBe(c.seqA);
    expect(atB.seq).toBe(c.seqB);
    // اللقطة الأولى: ثلاث عقد (أليس، بوب، وادعاء الاسم على أليس) ولا أثر لديف أو الدمج
    expect(atA.graph.nodes.map((n) => n.canonicalKey).sort()).toEqual(["person:alice", "person:bob"]);
    expect(atA.graph.edges).toHaveLength(1);
    // اللقطة الثانية: بوب اختفى كعقدة (دُمج) وديف ظهر
    expect(atB.graph.nodes.map((n) => n.canonicalKey).sort()).toEqual(["person:alice", "person:dave"]);
  });
});

/**
 * جولة المراجعة (round 2): العيوب المحددة تُختبر أحمر قبل إصلاحها — لا أحمر رجعياً.
 *  - T-TIME-011 (أحمر): مخزون الادعاءات — ادعاء طرفاه دُمجا في عقدة واحدة يجب أن
 *    يبقى مُقدَّماً في إسقاط القضية (اليوم يختفي من كل المُقدَّم ما عدا العدّاد).
 *  - T-TIME-012 (أحمر): مساواة المحتوى قانونية لا حساسة لترتيب المفاتيح — لقطتان
 *    متطابقتان دلالياً بترتيب مفاتيح مختلف في props/labels يجب أن تنتجا فرقاً فارغاً.
 *  - T-TIME-013 (تحقق): ادعاء يُعاد توجيه أحد طرفيه بالدمج دون حلقة ذاتية يُبلَّغ
 *    «مغيّراً» — مسار claims.changed بتوقع غير صفري.
 */
describe("P4-008 review round 2 (T-TIME-011..013)", () => {
  it("T-TIME-011: a claim whose ends merged into one node is still served by the case projection", () => {
    const c = caseFixture();
    const entries = [...c.f.ledger.entries()];
    const atB = project(entries, { upTo: c.seqB });
    // الادعاء «تعرف أليس بوب» ما زال في القضية (counts.claims يشمله) — يجب أن يُقدَّم
    // محتواه في مخزون ادعاءات الإسقاط، وهدفه محلول عبر الدمج (alice بعد أن كان bob)
    const served = atB.claims.find((x) => x.claimId === c.knows);
    expect(served).toBeDefined();
    expect(served?.subjectKey).toBe("person:alice");
    expect(served?.targetKey).toBe("person:alice"); // حل الدمج: bob صار ضمن alice
  });

  it("T-TIME-012: identical content with different props/labels key order produces an empty entity diff", () => {
    // عقد المقارنة يُختبر مباشرة: إسقاطان مُركّبان يدوياً بمحتوى واحد وترتيب مفاتيح مختلف
    const node = (props: Record<string, unknown>, labels: Record<string, string>) =>
      ({
        id: "n1",
        type: "person",
        canonicalKey: "person:x",
        labels,
        props,
        aliases: [],
        attributes: [],
        observations: { positive: 0, negative: 0, error: 0 },
        evidenceIds: [],
      }) as never;
    const a = { seq: 1, claims: [], graph: { nodes: [node({ a: 1, b: 2 }, { ar: "س", en: "x" })], edges: [] } } as never;
    const b = { seq: 1, claims: [], graph: { nodes: [node({ b: 2, a: 1 }, { en: "x", ar: "س" })], edges: [] } } as never;
    const d = diffProjections(a, b);
    expect(d.entities.changed).toHaveLength(0);
    expect(d.counts.entities).toEqual({ added: 0, removed: 0, changed: 0 });
  });

  it("T-TIME-013: a claim whose subject is retargeted by a merge (no self-loop) is reported as changed", () => {
    // سيناريو من ثلاث كيانات: ادعاء alice→bob، ثم دمج alice في carol (carol ≠ bob) —
    // الحافة تبقى (carol→bob ليست حلقة ذاتية) والادعاء نفسه يُبلَّغ «مغيّراً» لأن
    // طرفه المحلول تغيّر (person:alice → person:carol)، لا مضافاً ولا محذوفاً.
    // (تصحيح جولة المراجعة 3: الجولة السابقة استخدمت سيناريو الحلقة الذاتية نفسه —
    // هذا السيناريو الفعلي بلا حلقة. اجتاز مباشرة فيوثق كتغطية لسلوك قائم.)
    const f = fixture();
    const alice = f.entity("person", "alice");
    const bob = f.entity("person", "bob");
    const knows = f.relation(alice, "knows", bob);
    const seqA = lastSeq(f.ledger.entries());
    const carol = f.entity("person", "carol");
    f.add("merge.decided", {
      id: f.id(),
      entityIds: [alice, carol],
      survivorId: carol,
      reasons: ["same person per analyst review"],
      decidedBy: "analyst",
      decidedAt: T0,
      reverted: false,
    });
    const seqB = lastSeq(f.ledger.entries());
    const entries = [...f.ledger.entries()];
    const atB = project(entries, { upTo: seqB });
    // الحافة بقيت مُقدَّمة (لا حلقة ذاتية): carol→bob
    expect(atB.graph.edges.map((e) => e.id)).toContain(knows);
    const d = diffProjections(project(entries, { upTo: seqA }), atB);
    expect(d.claims.added).toHaveLength(0);
    expect(d.claims.removed).toHaveLength(0);
    expect(d.claims.changed.map((x) => x.id)).toEqual([knows]);
    expect(d.claims.changed[0].before.subjectKey).toBe("person:alice");
    expect(d.claims.changed[0].after.subjectKey).toBe("person:carol");
  });

  it("T-TIME-014: reversing the diff direction reports the added claim as removed (core function)", () => {
    // دالة النواة تقبل المقارنة بأي اتجاه (منع from>to هو على مستوى CLI فقط) —
    // الادعاء الذي أُضيف بين اللقطتين يظهر ضمن removed عند عكس الاتجاه، وهذا
    // يغطي مسار claims.removed بتوقع غير صفري دون انتظار أحداث حذف مستقبلية.
    const c = caseFixture();
    const entries = [...c.f.ledger.entries()];
    const forward = diffProjections(project(entries, { upTo: c.seqA }), project(entries, { upTo: c.seqB }));
    expect(forward.claims.added.map((x) => x.claimId)).toEqual([c.daveName]);
    const backward = diffProjections(project(entries, { upTo: c.seqB }), project(entries, { upTo: c.seqA }));
    expect(backward.claims.removed.map((x) => x.claimId)).toEqual([c.daveName]);
    expect(backward.counts.claims.removed).toBe(1);
  });
});

describe("P4-008 diff by legal keys (T-TIME-007..010)", () => {
  it("T-TIME-007: entities and claims added after the first snapshot are reported as added", () => {
    const c = caseFixture();
    const entries = [...c.f.ledger.entries()];
    const d = diffProjections(project(entries, { upTo: c.seqA }), project(entries, { upTo: c.seqB }));
    expect(d.entities.added.map((n) => n.canonicalKey)).toEqual(["person:dave"]);
    expect(d.claims.added.map((x) => x.claimId)).toEqual([c.daveName]);
    expect(d.counts.entities.added).toBe(1);
    expect(d.counts.claims.added).toBe(1);
  });

  it("T-TIME-008: an entity merged away between the snapshots is reported as removed", () => {
    const c = caseFixture();
    const entries = [...c.f.ledger.entries()];
    const d = diffProjections(project(entries, { upTo: c.seqA }), project(entries, { upTo: c.seqB }));
    expect(d.entities.removed.map((n) => n.canonicalKey)).toEqual(["person:bob"]);
    expect(d.counts.entities.removed).toBe(1);
    // الادعاء «تعرف أليس بوب» لم يُحذف من السجل (السجل إلحاقي) وبقي في مخزون
    // ادعاءات الإسقاط (T-TIME-011) — طرفاه دُمجا في عقدة واحدة فحُلّ هدفه من bob
    // إلى alice فيُبلَّغ «مغيّراً» لا «محذوفاً» (القضية احتفظت به — انظر T-TIME-013)
    expect(d.claims.removed).toHaveLength(0);
    expect(d.claims.changed.map((x) => x.id)).toEqual([c.knows]);
  });

  it("T-TIME-009: the merge survivor is reported as changed (its aliases grew)", () => {
    const c = caseFixture();
    const entries = [...c.f.ledger.entries()];
    const d = diffProjections(project(entries, { upTo: c.seqA }), project(entries, { upTo: c.seqB }));
    expect(d.entities.changed).toHaveLength(1);
    const change = d.entities.changed[0];
    expect(change.key).toBe("person:alice");
    expect(change.before.aliases).toHaveLength(0);
    expect(change.after.aliases).toContain(c.bob);
    expect(d.counts.entities.changed).toBe(1);
  });

  it("T-TIME-010: diffing a snapshot against itself is empty, and the counts match the reference truth (UC-09)", () => {
    const c = caseFixture();
    const entries = [...c.f.ledger.entries()];
    const same = diffProjections(project(entries, { upTo: c.seqB }), project(entries, { upTo: c.seqB }));
    expect(same.entities.added).toHaveLength(0);
    expect(same.entities.removed).toHaveLength(0);
    expect(same.entities.changed).toHaveLength(0);
    expect(same.claims.added).toHaveLength(0);
    expect(same.claims.removed).toHaveLength(0);
    expect(same.claims.changed).toHaveLength(0);
    expect(same.counts).toEqual({
      entities: { added: 0, removed: 0, changed: 0 },
      claims: { added: 0, removed: 0, changed: 0 },
    });
    // الحقيقة المرجعية الكاملة للفرق seqA→seqB (UC-09: أرقام الفرق تطابق الحقيقة):
    const full = diffProjections(project(entries, { upTo: c.seqA }), project(entries, { upTo: c.seqB }));
    expect(full.counts).toEqual({
      entities: { added: 1, removed: 1, changed: 1 },
      claims: { added: 1, removed: 0, changed: 1 },
    });
    expect(full.fromSeq).toBe(c.seqA);
    expect(full.toSeq).toBe(c.seqB);
  });
});
