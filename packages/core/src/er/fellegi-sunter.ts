/**
 * P4-004 (ROADMAP 5.14 الأوزان / D9) — the simplified Fellegi-Sunter model.
 *
 * Every comparison feature has LEVELS (agree / partial / disagree; missing is
 * neutral). Each level ℓ of feature f contributes the log-odds
 *   w(f, ℓ) = ln( m(f,ℓ) / u(f,ℓ) )
 * where m(f,ℓ) = P(level ℓ | true match) and u(f,ℓ) = P(level ℓ | candidate
 * non-match), estimated by DIRECT COUNTING from the labeled TRAIN split
 * (deterministic — no EM iteration needed when labels exist) with Laplace
 * smoothing so no weight is ±∞. Missing fields contribute exactly 0
 * (absence of evidence is not evidence of absence).
 *
 * A shared normalized identifier is DETERMINISTIC evidence (D9: مطابقة حتمية)
 * and outweighs any probabilistic combination.
 */
import { blockKeys } from "./blocking.ts";
import { erComparisonKey, jaroWinkler } from "./compare.ts";
import type { ErRecord, FsWeights, MatchReason, MatchSuggestion, ReferenceSplit } from "./types.ts";

/**
 * Decision thresholds (log-odds) — DECLARED constants, NOT estimated from any
 * data (delegated parameters, the pattern of RELIABILITY_WEIGHTS in P4-001):
 * the owner may retune them in ONE place. F1 acceptance is MEASURED on the
 * frozen eval set; the thresholds themselves were never fit to it.
 */
export const STRONG_THRESHOLD = 4.0;
export const REVIEW_THRESHOLD = 1.0;

/** Deterministic identifier evidence — larger than any plausible probabilistic score. */
export const IDENTIFIER_WEIGHT = 20.0;

/** Name agreement levels (Jaro-Winkler on the comparison keys). */
const NAME_AGREE = 0.93;
const NAME_PARTIAL = 0.85;
/** Address agreement (best Jaro-Winkler over token-sorted normalized addresses). */
const ADDRESS_AGREE = 0.88;

type Level = "agree" | "partial" | "disagree" | "missing";

/** Parses ISO YYYY-MM-DD, DD/MM/YYYY, or a bare YYYY — else undefined. */
export function parseDate(s: string): { y: number; m?: number; d?: number } | undefined {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (iso) return { y: +iso[1], m: +iso[2], d: +iso[3] };
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (dmy) return { y: +dmy[3], m: +dmy[2], d: +dmy[1] };
  const year = /^(\d{4})$/.exec(s.trim());
  if (year) return { y: +year[1] };
  return undefined;
}

function nameLevel(a: ErRecord, b: ErRecord): Level {
  if (!a.name || !b.name) return "missing";
  const jw = jaroWinkler(erComparisonKey(a.name), erComparisonKey(b.name));
  if (jw >= NAME_AGREE) return "agree";
  if (jw >= NAME_PARTIAL) return "partial";
  return "disagree";
}

function dateLevel(a: ErRecord, b: ErRecord): Level {
  const da = a.birthDate ? parseDate(a.birthDate) : undefined;
  const db = b.birthDate ? parseDate(b.birthDate) : undefined;
  if (da === undefined || db === undefined) return "missing";
  if (da.y === db.y && da.m === db.m && da.d === db.d) return "agree";
  if (da.y === db.y) return "partial";
  return "disagree";
}

/** Address comparison key: normalized, token-split, SORTED (word order is noise). */
function addressKey(s: string): string {
  return erComparisonKey(s)
    .split(/[^0-9\u0600-\u06FFa-z]+/)
    .filter((t) => t.length > 0)
    .sort()
    .join(" ");
}

function addressLevel(a: ErRecord, b: ErRecord): Level {
  const aa = (a.addresses ?? []).map(addressKey).filter((s) => s.length > 0);
  const bb = (b.addresses ?? []).map(addressKey).filter((s) => s.length > 0);
  if (aa.length === 0 || bb.length === 0) return "missing";
  let best = 0;
  for (const x of aa) for (const y of bb) best = Math.max(best, jaroWinkler(x, y));
  return best >= ADDRESS_AGREE ? "agree" : "disagree";
}

function sharedIdentifier(a: ErRecord, b: ErRecord): string | undefined {
  const set = new Set((b.identifiers ?? []).map((x) => x.toLowerCase()));
  for (const id of a.identifiers ?? []) if (set.has(id.toLowerCase())) return id;
  return undefined;
}

/**
 * Direct m/u estimation from the labeled split (Laplace-smoothed, deterministic).
 * The returned object carries ONE weight per (feature, level).
 */
export function estimateWeights(train: ReferenceSplit): FsWeights {
  const truth = new Set(train.duplicatePairs.map((p) => [p.a.id, p.b.id].sort().join("|")));
  const pairs = candidatePairs(train.records);
  const isMatch = (p: { a: ErRecord; b: ErRecord }) => truth.has([p.a.id, p.b.id].sort().join("|"));

  /**
   * DECLARED ESTIMATION POLICY (multi-level Laplace): m/u for one feature are
   * estimated CONDITIONED ON PRESENCE — only pairs whose level is not
   * "missing" count toward that feature's distribution (a missing field is
   * neutral in scoring, so it must not dilute the distribution either). The
   * Laplace denominator is N + K where K is THAT FEATURE's level count
   * (3 for name/date, 2 for address), so each feature's estimated
   * probabilities sum to EXACTLY 1 over its levels (T-ER-005b).
   */
  const estimate = (level: (a: ErRecord, b: ErRecord) => Level, levels: readonly Level[]): Record<Level, number> => {
    const present = pairs.filter((p) => level(p.a, p.b) !== "missing");
    const mN = present.filter(isMatch).length;
    const uN = present.length - mN;
    const K = levels.length;
    const mOf = (t: Level) => (present.filter((p) => isMatch(p) && level(p.a, p.b) === t).length + 1) / (mN + K);
    const uOf = (t: Level) => (present.filter((p) => !isMatch(p) && level(p.a, p.b) === t).length + 1) / (uN + K);
    return Object.fromEntries(levels.map((t) => [t, Math.log(mOf(t) / uOf(t))])) as Record<Level, number>;
  };

  const name = estimate(nameLevel, ["agree", "partial", "disagree"]);
  const date = estimate(dateLevel, ["agree", "partial", "disagree"]);
  const address = estimate(addressLevel, ["agree", "disagree"]);

  return {
    name: name.agree,
    namePartial: name.partial,
    nameDisagree: name.disagree,
    date: date.agree,
    datePartial: date.partial,
    dateDisagree: date.disagree,
    address: address.agree,
    addressDisagree: address.disagree,
  };
}

/** Enumerates the blocking candidates as id-ordered unique pairs (deterministic). */
function candidatePairs(records: ErRecord[]): Array<{ a: ErRecord; b: ErRecord }> {
  const blocks = new Map<string, ErRecord[]>();
  for (const r of records) {
    for (const k of blockKeys(r)) {
      const list = blocks.get(k) ?? [];
      list.push(r);
      blocks.set(k, list);
    }
  }
  const seen = new Set<string>();
  const out: Array<{ a: ErRecord; b: ErRecord }> = [];
  for (const key of [...blocks.keys()].sort()) {
    const list = blocks.get(key) as ErRecord[];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [x, y] = [list[i], list[j]].sort((r1, r2) => (r1.id < r2.id ? -1 : 1));
        const pk = `${x.id}|${y.id}`;
        if (seen.has(pk)) continue;
        seen.add(pk);
        out.push({ a: x, b: y });
      }
    }
  }
  return out;
}

/**
 * Scores ONE candidate pair. Pure, deterministic, explainable: the score is
 * EXACTLY the sum of the reason weights (D9 التفسير).
 */
export function scorePair(a: ErRecord, b: ErRecord, weights: FsWeights): MatchSuggestion {
  const reasons: MatchReason[] = [];

  const shared = sharedIdentifier(a, b);
  if (shared !== undefined) {
    reasons.push({
      feature: "identifier",
      weight: IDENTIFIER_WEIGHT,
      detail: `معرّف مطبَّع مشترك: ${shared} — مطابقة حتمية (D9)`,
    });
  }

  const nl = nameLevel(a, b);
  if (nl === "agree") reasons.push({ feature: "name", weight: weights.name, detail: `تطابق الاسم (Jaro-Winkler ≥ ${NAME_AGREE})` });
  else if (nl === "partial")
    reasons.push({ feature: "namePartial", weight: weights.namePartial, detail: `تشابه جزئي للاسم (≥ ${NAME_PARTIAL})` });
  else if (nl === "disagree") reasons.push({ feature: "nameDisagree", weight: weights.nameDisagree, detail: "اختلاف الاسم" });

  const dl = dateLevel(a, b);
  if (dl === "agree") reasons.push({ feature: "date", weight: weights.date, detail: "تطابق التاريخ" });
  else if (dl === "partial") reasons.push({ feature: "datePartial", weight: weights.datePartial, detail: "تطابق سنة التاريخ" });
  else if (dl === "disagree") reasons.push({ feature: "dateDisagree", weight: weights.dateDisagree, detail: "اختلاف التاريخ" });

  const al = addressLevel(a, b);
  if (al === "agree") reasons.push({ feature: "address", weight: weights.address, detail: "تطابق العنوان" });
  else if (al === "disagree") reasons.push({ feature: "addressDisagree", weight: weights.addressDisagree, detail: "اختلاف العنوان" });

  const score = reasons.reduce((acc, r) => acc + r.weight, 0);
  // D9 (مطابقة حتمية): a shared normalized identifier IS the same real-world
  // entity — the decision is strong WHATEVER the probabilistic evidence says.
  // The guarantee lives in the DECISION RULE, not in the size of the constant
  // (T-ER-006b: disagreement weights can never cancel it). The score stays the
  // honest sum of reason weights; the suggestion is still a SUGGESTION.
  const decision =
    shared !== undefined
      ? "strong"
      : score >= STRONG_THRESHOLD
        ? "strong"
        : score >= REVIEW_THRESHOLD
          ? "review"
          : "none";
  return { aId: a.id, bId: b.id, score, decision, reasons };
}
