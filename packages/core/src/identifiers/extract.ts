import { detect, type Candidate } from "./detect.ts";

/**
 * Free-text extraction (UC-02, P1-020): split the text into tokens, strip surrounding punctuation, and run the
 * multi-candidate detector on each token with the neighbouring words as context. A token is reported when its best
 * candidate is validated (checksum/registry/PSL), specific enough to stand alone, or supported by a context word;
 * ordinary words that only fit generic username patterns are not.
 */
export interface Extracted {
  start: number;
  end: number;
  value: string;
  best: Candidate;
  candidates: Candidate[];
}

export interface ExtractOptions {
  /** Tokens before the value used as context (default 5); labels usually precede values. */
  before?: number;
  /** Tokens after the value used as context (default 2). */
  after?: number;
  /** Minimum specificity for an unvalidated, context-free candidate (default 0.5). */
  minSpecificity?: number;
}

// Linear trimming (no regex backtracking on long punctuation runs, CodeQL js/polynomial-redos).
const LEAD = new Set([..."([{\"'«“‘<"]);
const TRAIL = new Set([...")]}\"'»”’>.,;:!?،؛"]);

interface Token {
  start: number;
  end: number;
  value: string;
}

function tokens(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(/\S+/gu)) {
    const v0 = m[0];
    let a = 0,
      b = v0.length;
    while (a < b && LEAD.has(v0.charAt(a))) a++;
    while (b > a && TRAIL.has(v0.charAt(b - 1))) b--;
    const v = v0.slice(a, b);
    const start = m.index + a;
    if (v) out.push({ start, end: start + v.length, value: v });
  }
  return out;
}

const reportable = (c: Candidate, minSpecificity: number) => c.validated || c.context.length > 0 || c.specificity >= minSpecificity;

export function extract(text: string, opts: ExtractOptions = {}): Extracted[] {
  const before = opts.before ?? 5;
  const after = opts.after ?? 2;
  const minSpecificity = opts.minSpecificity ?? 0.5;
  const toks = tokens(text);
  const out: Extracted[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const context = [...toks.slice(Math.max(0, i - before), i), ...toks.slice(i + 1, i + 1 + after)].map((x) => x.value).join(" ");
    const candidates = detect(t.value, { context });
    const best = candidates[0];
    if (best && reportable(best, minSpecificity)) out.push({ ...t, best, candidates });
    // P2-011: a person name is multi-word by pattern (person_name), so a token alone never matches it.
    // Check adjacent-token spans for the multi-word type; the longest match wins, removes the
    // single-token hits it covers and consumes its tokens.
    const span = personNameSpan(toks, i, before, after, minSpecificity);
    if (span === undefined) continue;
    const covered = out.filter((h) => h.start >= span.hit.start && h.end <= span.hit.end);
    for (const c of covered) out.splice(out.indexOf(c), 1);
    out.push(span.hit);
    i += span.consumed; // the remaining tokens of the span are consumed
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

/**
 * P2-011: the longest adjacent-token span (3 then 2 tokens) that reads as a person_name, or undefined.
 * The hit covers the whole span (a person name "Bob Smith" suppresses the single-token "Bob"/"Smith"
 * readings it subsumes, so the inventory judges the whole name, not its parts).
 */
function personNameSpan(
  toks: Token[],
  i: number,
  before: number,
  after: number,
  minSpecificity: number,
): { hit: Extracted; consumed: number } | undefined {
  for (const span of [3, 2]) {
    if (i + span > toks.length) continue;
    const words = toks.slice(i, i + span);
    const value = words.map((w) => w.value).join(" ");
    const context = [...toks.slice(Math.max(0, i - before), i), ...toks.slice(i + span, i + span + after)].map((x) => x.value).join(" ");
    const spanBest = detect(value, { context })[0];
    if (spanBest?.type !== "person_name" || !reportable(spanBest, minSpecificity)) continue;
    return {
      hit: { start: words[0].start, end: words[words.length - 1].end, value, best: spanBest, candidates: detect(value, { context }) },
      consumed: span - 1,
    };
  }
  return undefined;
}
