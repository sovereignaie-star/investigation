import { normalizeArabicName } from "@ir/arabic";

/**
 * P4-004 (ROADMAP 5.14) — comparison primitives: Jaro-Winkler and the Arabic
 * comparison key.
 *
 * The comparison key is DECLARED APPROXIMATE — it is a similarity aid, never an
 * identity (identity is `canonicalKey` from P1-007). The folds are the minimal
 * set 5.14 needs. P5-003: Arabic text now goes through the FULL P5-001
 * normalization (`normalizeArabicName`) — the minimal fold is superseded.
 */

const ARABIC = /[\u0600-\u06FF]/;

/**
 * The Arabic/Latin comparison key: Arabic text goes through the FULL P5-001
 * normalization (`normalizeArabicName` — the P4-004 minimal fold superseded);
 * Latin text is lowercased. Whitespace collapsed, trimmed. Pure and total.
 */
export function erComparisonKey(text: string): string {
  const normalized = ARABIC.test(text) ? normalizeArabicName(text) : text.toLowerCase().replace(/\s+/g, " ").trim();
  return normalized.replace(/\s+/g, " ").trim();
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
