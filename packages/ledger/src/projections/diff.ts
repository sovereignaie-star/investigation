import type { Entry } from "../ledger.ts";
import type { Projection } from "./index.ts";
import type { GraphEdge, GraphNode } from "./views.ts";

/**
 * P4-008 — الفرق بين لقطتين من سلسلة القضية بالمفاتيح القانونية (ROADMAP 5.15/UC-09).
 *
 * اللقطة نفسها قائمة من P1-016: `project(entries, { upTo })` — هذه الوحدة تضيف المقارنة.
 * المفاتيح القانونية: الكيان بمفتاحه القانوني (canonicalKey) والادعاء بمعرّفه.
 *
 * قرارات التصميم الموثقة (WORKLOG جولة 1):
 *  - «تغيّر» الكيان = اختلاف محتوى الهوية المُقدَّم: التسميات/الخصائص/الأسماء
 *    المستعارة. الصفات (ادعاءات القيم الحرفية على العقدة) تُحسب في جانب الادعاءات،
 *    لا في «تغيّر» الكيان — منعاً للعدّ المزدوج.
 *  - «تغيّر» الادعاء = اختلاف محتواه المُقدَّم (المسند/الهدف/القيمة/الصلاحية/نافذة
 *    الحدوث/الثقة). تراكم الملاحظات والأدلة (evidenceIds/observations) ليس تغيّراً
 *    للمحتوى بل تورّع أدلة — خارج تعريف «التغيّر» هنا.
 *  - في نموذج الأحداث الحالي الادعاءات إلحاقية (claim.added بلا تحديث)، فلا «ادعاء
 *    محذوف/مغيّر» عملياً بعد الإضافة — التعريف عام للمستقبل وموثق بذلك. حالة موثقة:
 *    ادعاء علاقة طرفاه دُمجا في عقدة واحدة يختفي كحافة من الرسم (حلقة ذاتية
 *    مستبعدة بالتصميم) فيُبلَّغ «محذوفاً» — لم يُحذف من السجل (إلحاقي) وبقي في عدّاد
 *    الجدول؛ «المحذوف» هنا = اختفى من الإسقاط المُقدَّم حصراً.
 *  - الادعاءات التي لا تُقدَّم في الإسقاط (كياناتها غير معروفة) لا تدخل المقارنة —
 *    الإسقاط نفسه يستبعيها من الرسم، والمقارنة على المُقدَّم حصراً.
 */

/** An attribute claim as the diff compares it — served content, evidence accrual excluded. */
export interface DiffClaim {
  claimId: string;
  kind: "relation" | "attribute";
  /** canonicalKey of the subject node (resolved through merges). */
  subjectKey: string;
  predicate: string;
  /** Relation: canonicalKey of the object node. Attribute: null. */
  targetKey: string | null;
  /** Attribute: the literal value. Relation: null. */
  value: string | number | boolean | null;
  validFrom: string | null;
  validTo: string | null;
  occurredFrom: string | null;
  occurredTo: string | null;
  confidence: number;
}

export interface EntityChange {
  key: string;
  before: GraphNode;
  after: GraphNode;
}

export interface ClaimChange {
  id: string;
  before: DiffClaim;
  after: DiffClaim;
}

export interface CaseDiff {
  fromSeq: number;
  toSeq: number;
  entities: {
    added: GraphNode[];
    removed: GraphNode[];
    changed: EntityChange[];
  };
  claims: {
    added: DiffClaim[];
    removed: DiffClaim[];
    changed: ClaimChange[];
  };
  counts: {
    entities: { added: number; removed: number; changed: number };
    claims: { added: number; removed: number; changed: number };
  };
}

/** The identity content of a node as the diff compares it — labels, props, aliases (sorted). */
function nodeIdentity(n: GraphNode): string {
  return JSON.stringify([n.id, n.type, n.canonicalKey, n.labels, n.props, [...n.aliases].sort()]);
}

/** The served content of a claim as the diff compares it — evidence accrual excluded. */
function claimContent(c: DiffClaim): string {
  return JSON.stringify([
    c.claimId,
    c.kind,
    c.subjectKey,
    c.predicate,
    c.targetKey,
    c.value,
    c.validFrom,
    c.validTo,
    c.occurredFrom,
    c.occurredTo,
    c.confidence,
  ]);
}

/** Every claim the projection serves (relation edges + node attributes), keyed by claimId. */
function servedClaims(p: Projection): Map<string, DiffClaim> {
  const byId = new Map<string, GraphNode>();
  for (const n of p.graph.nodes) byId.set(n.id, n);
  const claims = new Map<string, DiffClaim>();
  for (const n of p.graph.nodes) {
    for (const a of n.attributes) {
      claims.set(a.claimId, {
        claimId: a.claimId,
        kind: "attribute",
        subjectKey: n.canonicalKey,
        predicate: a.predicate,
        targetKey: null,
        value: a.value,
        validFrom: a.validFrom,
        validTo: a.validTo,
        occurredFrom: a.occurredFrom,
        occurredTo: a.occurredTo,
        confidence: a.confidence,
      });
    }
  }
  for (const e of p.graph.edges as GraphEdge[]) {
    const subject = byId.get(e.source);
    const target = byId.get(e.target);
    claims.set(e.id, {
      claimId: e.id,
      kind: "relation",
      subjectKey: subject?.canonicalKey ?? "",
      predicate: e.predicate,
      targetKey: target?.canonicalKey ?? "",
      value: null,
      validFrom: e.validFrom,
      validTo: e.validTo,
      occurredFrom: e.occurredFrom,
      occurredTo: e.occurredTo,
      confidence: e.confidence,
    });
  }
  return claims;
}

/**
 * Compares two snapshots of one case by legal keys (UC-09). The projections must come
 * from the same chain; `fromSeq`/`toSeq` are echoed from the projections themselves
 * so the diff never claims a range it did not see.
 */
export function diffProjections(a: Projection, b: Projection): CaseDiff {
  const aNodes = new Map(a.graph.nodes.map((n) => [n.canonicalKey, n] as const));
  const bNodes = new Map(b.graph.nodes.map((n) => [n.canonicalKey, n] as const));
  const added: GraphNode[] = [];
  const removed: GraphNode[] = [];
  const changed: EntityChange[] = [];
  for (const [key, node] of bNodes) {
    const before = aNodes.get(key);
    if (!before) added.push(node);
    else if (nodeIdentity(before) !== nodeIdentity(node)) changed.push({ key, before, after: node });
  }
  for (const [key, node] of aNodes) if (!bNodes.has(key)) removed.push(node);

  const aClaims = servedClaims(a);
  const bClaims = servedClaims(b);
  const claimsAdded: DiffClaim[] = [];
  const claimsRemoved: DiffClaim[] = [];
  const claimsChanged: ClaimChange[] = [];
  for (const [id, claim] of bClaims) {
    const before = aClaims.get(id);
    if (!before) claimsAdded.push(claim);
    else if (claimContent(before) !== claimContent(claim)) claimsChanged.push({ id, before, after: claim });
  }
  for (const [id, claim] of aClaims) if (!bClaims.has(id)) claimsRemoved.push(claim);

  added.sort((x, y) => x.canonicalKey.localeCompare(y.canonicalKey));
  removed.sort((x, y) => x.canonicalKey.localeCompare(y.canonicalKey));
  changed.sort((x, y) => x.key.localeCompare(y.key));
  claimsAdded.sort((x, y) => x.claimId.localeCompare(y.claimId));
  claimsRemoved.sort((x, y) => x.claimId.localeCompare(y.claimId));
  claimsChanged.sort((x, y) => x.id.localeCompare(y.id));

  return {
    fromSeq: a.seq,
    toSeq: b.seq,
    entities: { added, removed, changed },
    claims: { added: claimsAdded, removed: claimsRemoved, changed: claimsChanged },
    counts: {
      entities: { added: added.length, removed: removed.length, changed: changed.length },
      claims: { added: claimsAdded.length, removed: claimsRemoved.length, changed: claimsChanged.length },
    },
  };
}

/** Type re-export so callers can build Entry iterables without reaching into internals. */
export type { Entry };
