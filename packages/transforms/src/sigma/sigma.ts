/**
 * P4-021 — the Sigma matcher (محوّل محلي LC-A; pure evaluation over structured
 * events — nothing fetched, nothing executed).
 *
 * The rules of record are the frozen official SigmaHQ rules converted to the
 * documented NORMALIZED form by tools/threat-rules/build_reference.py — the
 * runtime never touches YAML. Semantics implemented (documented subset):
 * - field matchers: `is` (equality, case-insensitive), `contains`,
 *   `startswith`, `endswith` (all case-insensitive — Sigma's default);
 * - within one alternative, matchers are AND'd; the selection's alternatives
 *   are OR'd;
 * - conditions: `all of <prefix>*` (every selection with that prefix must
 *   match), `any of <prefix>*`, plain named conjunctions (`a and b`), and
 *   `and not <N> of <prefix>*` filter clauses (a matching filter subtracts).
 * A missing field never matches (fail-closed, no invention).
 */

/** One event to evaluate — a structured log record. */
export type SigmaEvent = Record<string, unknown>;

export interface SigmaMatcher {
  field: string;
  modifier: "is" | "contains" | "startswith" | "endswith";
  values: string[];
}
export interface SigmaSelection {
  name: string;
  alternatives: { matchers: SigmaMatcher[] }[];
}
export interface SigmaCondition {
  kind: "all-of-prefix" | "any-of-prefix" | "all-named";
  prefix?: string;
  names?: string[];
  excludes?: { kind: "all-of-prefix" | "any-of-prefix"; prefix: string; minCount: number | null }[];
}

/** The normalized rule (the generated frozen data uses this shape). */
export interface NormalizedSigmaRule {
  id: string;
  title: string;
  level: string;
  tags: string[];
  logsource: Record<string, unknown>;
  selections: SigmaSelection[];
  condition: SigmaCondition;
}

const asText = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

function matchValue(actual: string, matcher: SigmaMatcher, value: string): boolean {
  const a = actual.toLowerCase();
  const b = value.toLowerCase();
  switch (matcher.modifier) {
    case "is":
      return a === b;
    case "contains":
      return a.includes(b);
    case "startswith":
      return a.startsWith(b);
    case "endswith":
      return a.endsWith(b);
  }
}

function matchMatcher(ev: SigmaEvent, matcher: SigmaMatcher): boolean {
  const actual = ev[matcher.field];
  if (actual === undefined) return false; // حقل غائب لا يطابق أبداً
  return matcher.values.some((value) => matchValue(asText(actual), matcher, value));
}

function matchSelection(ev: SigmaEvent, sel: SigmaSelection): boolean {
  return sel.alternatives.some((alt) => alt.matchers.every((m) => matchMatcher(ev, m)));
}

function matchesOf(rule: NormalizedSigmaRule, ev: SigmaEvent, prefix: string): { total: number; matched: number } {
  const sels = rule.selections.filter((s) => s.name.startsWith(prefix));
  return { total: sels.length, matched: sels.filter((s) => matchSelection(ev, s)).length };
}

/** Evaluate the rule against one event. */
export function matchSigma(rule: NormalizedSigmaRule, ev: SigmaEvent): boolean {
  const cond = rule.condition;
  let core: boolean;
  if (cond.kind === "all-of-prefix") {
    const { total, matched } = matchesOf(rule, ev, cond.prefix ?? "");
    core = total > 0 && matched === total;
  } else if (cond.kind === "any-of-prefix") {
    const { matched } = matchesOf(rule, ev, cond.prefix ?? "");
    core = matched > 0;
  } else {
    const names = cond.names ?? [];
    core =
      names.length > 0 &&
      names.every((n) => {
        const sel = rule.selections.find((s) => s.name === n);
        return sel !== undefined && matchSelection(ev, sel);
      });
  }
  if (!core) return false;
  // الفلاتر تطرح: تطابق أي فلتر مستبعد يلغي الحدث
  for (const ex of cond.excludes ?? []) {
    const { total, matched } = matchesOf(rule, ev, ex.prefix);
    const exMatched = ex.kind === "all-of-prefix" ? total > 0 && matched === total : matched > 0;
    if (exMatched) return false;
  }
  return true;
}
