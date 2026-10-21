import { canonicalize } from "../jcs.ts";
import type { Entry } from "../ledger.ts";
import type { Projection } from "./index.ts";
import type { GraphNode, ServedClaim } from "./views.ts";

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
 *  - في نموذج الأحداث الحالي الادعاءات إلحاقية (claim.added بلا تحديث) — التعريف
 *    عام للمستقبل وموثق بذلك. مقارنة الادعاءات تجري على مخزون ادعاءات الإسقاط
 *    (Projection.claims، المضاف في هذه الجولة): كل ادعاء كياناته معروفة، محلول
 *    عبر الدمج — ومنه ادعاء العلاقة الذي صار حلقة ذاتية بعد دمج طرفيه: يبقى في
 *    المخزون ويُبلَّغ «مغيّراً» (تمثيله المُقدَّم تغيّر: الهدف حلّ إلى عقدة أخرى)،
 *    لا «محذوفاً» — القضية احتفظت به.
 *  - الادعاءات التي لا تُقدَّم في المخزون (كياناتها غير معروفة) لا تدخل المقارنة —
 *    الإسقاط نفسه يستبعدها، والمقارنة على المُقدَّم حصراً.
 */

export interface EntityChange {
  key: string;
  before: GraphNode;
  after: GraphNode;
}

export interface ClaimChange {
  id: string;
  before: ServedClaim;
  after: ServedClaim;
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
    added: ServedClaim[];
    removed: ServedClaim[];
    changed: ClaimChange[];
  };
  counts: {
    entities: { added: number; removed: number; changed: number };
    claims: { added: number; removed: number; changed: number };
  };
}

/**
 * The identity content of a node as the diff compares it — labels, props, aliases —
 * in JCS canonical form so key ORDER never fabricates a change (T-TIME-012).
 */
function nodeIdentity(n: GraphNode): string {
  return canonicalize({
    id: n.id,
    type: n.type,
    canonicalKey: n.canonicalKey,
    labels: n.labels,
    props: n.props,
    aliases: [...n.aliases].sort(),
  });
}

/**
 * The served content of a claim as the diff compares it — JCS canonical form (key order
 * never fabricates a change), evidence accrual excluded by the inventory's definition.
 */
function claimContent(c: ServedClaim): string {
  return canonicalize(c);
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

  // P4-008: the claim inventory (Projection.claims) is the comparison source — it
  // serves EVERY known claim, including merge self-loops the graph excludes.
  const aClaims = new Map(a.claims.map((c) => [c.claimId, c] as const));
  const bClaims = new Map(b.claims.map((c) => [c.claimId, c] as const));
  const claimsAdded: ServedClaim[] = [];
  const claimsRemoved: ServedClaim[] = [];
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
