/**
 * P4-004 (ROADMAP 5.14) — comparison primitives: Jaro-Winkler and the Arabic
 * comparison key.
 *
 * The comparison key is DECLARED APPROXIMATE — it is a similarity aid, never an
 * identity (identity is `canonicalKey` from P1-007). The folds are the minimal
 * set 5.14 needs; the full Arabic normalization/transliteration program is
 * P5-002/P5-003 and is deliberately NOT preempted here.
 */

/** Matches: a (globalized) Regex — the ranges of Arabic diacritics + tatweel. */
const DIACRITICS = /[\u{064B}-\u{0652}\u{0670}\u{0640}]/gu;
/** Alef variants fold to plain alef; taa marbuta to haa; alef maqsura to yaa. */
const ALEF = /\u{0622}|\u{0623}|\u{0625}/gu;

/**
 * The Arabic/Latin comparison key: strip diacritics and tatweel, fold alef
 * variants (أ إ آ → ا), taa marbuta (ة → ه), alef maqsura (ى → ي), lowercase
 * Latin, collapse whitespace. Pure and total.
 */
export function erComparisonKey(text: string): string {
  return text
    .normalize("NFKC")
    .replace(DIACRITICS, "")
    .replace(ALEF, "\u0627")
    .replace(/\u0629/gu, "\u0647")
    .replace(/\u0649/gu, "\u064A")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** The Jaro transposition count over the matched flags. */
function countTranspositions(a: string, b: string, aFlags: boolean[], bFlags: boolean[]): number {
  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < a.length; i++) {
    if (aFlags[i]) {
      while (!bFlags[k]) k++;
      if (a[i] !== b[k]) transpositions++;
      k++;
    }
  }
  return transpositions;
}

/**
 * Jaro similarity (0..1), then the Winkler prefix boost (p = 0.1, max prefix 4,
 * applied only when the base similarity clears the classic 0.7 threshold).
 * Reference values verified against Winkler's 1990 examples.
 */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1; // identity — including two empty strings
  if (a.length === 0 || b.length === 0) return 0;

  // --- Jaro core ---
  const aLen = a.length;
  const bLen = b.length;
  const window = Math.max(0, Math.floor(Math.max(aLen, bLen) / 2) - 1);
  const aFlags = new Array<boolean>(aLen).fill(false);
  const bFlags = new Array<boolean>(bLen).fill(false);
  let matches = 0;
  for (let i = 0; i < aLen; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, bLen);
    for (let j = start; j < end; j++) {
      if (!bFlags[j] && b[j] === a[i]) {
        aFlags[i] = true;
        bFlags[j] = true;
        matches++;
        break;
      }
    }
  }
  if (matches === 0) return 0;
  const transpositions = countTranspositions(a, b, aFlags, bFlags);
  const jaro = (matches / aLen + matches / bLen + (matches - transpositions / 2) / matches) / 3;
  if (jaro <= 0.7) return jaro;

  // --- Winkler boost ---
  let prefix = 0;
  const maxPrefix = Math.min(4, aLen, bLen);
  while (prefix < maxPrefix && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}
