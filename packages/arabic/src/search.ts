/**
 * P5-003 — مطابقة الأسماء العربية في البحث (search-side matching).
 *
 * The search side of the Arabic name program: a query in EITHER script must
 * find names written in EITHER script — token-wise, cross-script, honestly
 * (no forced matches). The merge side (blocking/comparison in the ER engine)
 * builds on the same primitives: `nameSkeleton` is the script-neutral block
 * key, `arabicNameMatches` is the token matcher.
 *
 * Design rules (documented, no hidden magic):
 * - matching is TOKEN-WISE: a query matches a candidate when EVERY query
 *   token matches SOME candidate token (family-name queries find full names);
 * - a token pair matches if both are Arabic (normalized equality or very
 *   close Jaro-Winkler), both are Latin (Jaro-Winkler), or they are
 *   CROSS-SCRIPT and the P5-002 backtracking matcher can produce one from
 *   the other (`latinMatchesArabic`);
 * - very short tokens (≤ 2 chars) never match a DIFFERENT short token —
 *   «علي» must not equal «عمر» just because both are small.
 */
import { latinMatchesArabic, arabicToLatin, type TranslitScheme } from "./translit.ts";
import { normalizeArabicName } from "./normalize.ts";

const ARABIC = /[\u0600-\u06FF]/;
export const isArabicScript = (s: string): boolean => ARABIC.test(s);

/**
 * P5-006 — تطبيع ما قبل التقطيع للمطابقة: تطبيع عربي كامل (يضم «عبد الله» ≡ «عبدالله»
 * عبر normalizeArabicName) + ضم اللاتيني «Abdul Aziz» ≡ «Abdulaziz» (نفس التركيب
 * المكتوب بالطريقتين في اللاتينية أيضاً). يعمل على الكتابتين ولا يغير المعنى.
 */
function matchNormalize(name: string): string {
  const out = normalizeArabicName(name);
  return out.replace(/\b(abdul|abd)\s+(\S)/gi, (_m, p1: string, p2: string) => p1 + p2);
}

/* ------------------------------------------------------- nameSkeleton */

/** Characters dropped from skeletons: Latin vowels/semivowels + ayn/hamza. */
const SKELETON_DROP = /[aeiouwy'`]/g;

/** إطار صوامت لاتيني (كلمات ≥ 4 حروف): Conrad-frame للاتيني-اللاتيني (P5-006). */
const latinFrame = (s: string) => s.replace(SKELETON_DROP, "");

/**
 * The script-neutral name skeleton: the consonant frame both scripts agree
 * on. محمد → "mhmd" ≡ Muhammad → "mhmd". Used as the cross-script BLOCK key
 * (coarse by design — blocking trades precision for recall, the scorer
 * filters). Pure and deterministic.
 */
export function nameSkeleton(name: string): string {
  let latin: string;
  if (isArabicScript(name)) {
    latin = arabicToLatin(normalizeArabicName(name), "ascii" as TranslitScheme);
  } else {
    latin = name.toLowerCase();
  }
  let skeleton = latin.replace(SKELETON_DROP, "");
  // final h in Arabic names is usually the ة ending (a vowel in Latin)
  skeleton = skeleton.replace(/h$/, "");
  // collapse runs of the same consonant (English doubles m in Muhammad;
  // Arabic doubles l in عبدالله) — consistently on BOTH scripts
  skeleton = skeleton.replace(/(.)\1+/g, "$1");
  return skeleton.replace(/\s+/g, " ").trim();
}

/* -------------------------------------------------- token matching */

/** Jaro core: the match/transposition counts of two strings. */
function jaroCounts(a: string, b: string): { matches: number; transpositions: number } {
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aFlags = new Array<boolean>(a.length).fill(false);
  const bFlags = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, b.length);
    for (let j = start; j < end; j++) {
      if (!bFlags[j] && b[j] === a[i]) {
        aFlags[i] = true;
        bFlags[j] = true;
        matches++;
        break;
      }
    }
  }
  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < a.length; i++) {
    if (aFlags[i]) {
      while (!bFlags[k]) k++;
      if (a[i] !== b[k]) transpositions++;
      k++;
    }
  }
  return { matches, transpositions };
}

/** Jaro-Winkler (0..1) — same algorithm family as the ER engine (P4-004). */
function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const { matches, transpositions } = jaroCounts(a, b);
  if (matches === 0) return 0;
  const jaro = (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
  if (jaro < 0.7) return jaro;
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

const JW_ARABIC = 0.92; // العربية المطبّعة متقاربة جداً — عتبة عالية صادقة
const JW_LATIN = 0.87;

/** لاتيني-لاتيني: «bin»≡«ibn» (D5)، JW، ثم إطار الصوامت (P5-006 — L-74 للمنطقة الملتبسة). */
function latinTokenMatches(q: string, c: string): boolean {
  const lq = q.toLowerCase();
  const lc = c.toLowerCase();
  if ((lq === "bin" && lc === "ibn") || (lq === "ibn" && lc === "bin")) return true;
  if (lq === lc || jaroWinkler(lq, lc) >= JW_LATIN) return true;
  // نفس الاسم بإملاءين متطابقي إطار الصوامت (Mohammed≡Muhammad، Saeed≡Said) —
  // قرار بحث معلن: الاسترجاع أولوية والمرشحات يراجعها الإنسان؛ المنطقة الملتبسة
  // (Salem≡Selim — إطاران متطابقان لاسمين عربيين مختلفين) سلوك موثق لا يُقاس (L-74).
  if (q.length >= 4 && c.length >= 4) return latinFrame(lq) === latinFrame(lc);
  return false;
}

/** Does one TOKEN match another across/within scripts? */
function tokenMatches(queryToken: string, candidateToken: string): boolean {
  const q = queryToken.trim();
  const c = candidateToken.trim();
  if (q.length === 0 || c.length === 0) return false;
  const qAr = isArabicScript(q);
  const cAr = isArabicScript(c);
  if (qAr && cAr) {
    const nq = normalizeArabicName(q);
    const nc = normalizeArabicName(c);
    return nq === nc || jaroWinkler(nq, nc) >= JW_ARABIC;
  }
  if (!qAr && !cAr) return latinTokenMatches(q, c);
  // عبر الكتابتين: البحث الراجع المعلن من P5-002 (لا تخمين) — مع حالة
  // «ال» التعريف: الكتابة اللاتينية قد تحذفها (Qahtani ≡ القحطاني)
  const latin = qAr ? c : q;
  const arabic = qAr ? q : c;
  const target = normalizeArabicName(arabic);
  return latinMatchesArabic(latin, target) || latinMatchesArabic(latin, target.replace(/^ال/, ""));
}

/**
 * Does the QUERY match the CANDIDATE NAME? Token-wise, every query token
 * must match some candidate token (the reverse is not required: «محمد»
 * matches «محمد الحربي»; «الحربي» also matches it — family-name search).
 */
export function arabicNameMatches(query: string, candidate: string): boolean {
  // التطبيع قبل التقطيع (P5-006): ضم «عبد الله» ≡ «عبدالله» و«Abdul Aziz» ≡ «Abdulaziz»
  // يعمل على الاسم كاملاً — تقطيع الاسم أولاً كان يفصل المركب فتفشل المطابقة
  const qTokens = matchNormalize(query)
    .split(/[\s\-,.]+/)
    .filter((t) => t.length > 0);
  if (qTokens.length === 0) return false;
  const cTokens = matchNormalize(candidate)
    .split(/[\s\-,.]+/)
    .filter((t) => t.length > 0);
  if (cTokens.length === 0) return false;
  return qTokens.every((qt) => cTokens.some((ct) => tokenMatches(qt, ct)));
}

/**
 * Search a mixed-script list of names: return the matching candidates,
 * deterministically ordered by best token similarity (exact matches first,
 * then Jaro-Winkler descending, then the input order for ties).
 */
export function searchArabicNames(query: string, candidates: readonly string[]): string[] {
  // تطبيع قبل التقطيع — نفس إصلاح arabicNameMatches (P5-006)
  const qTokens = matchNormalize(query)
    .split(/[\s\-,.]+/)
    .filter((t) => t.length > 0);
  if (qTokens.length === 0) return [];
  const scored: Array<{ name: string; score: number; index: number }> = [];
  candidates.forEach((candidate, index) => {
    const cTokens = matchNormalize(candidate)
      .split(/[\s\-,.]+/)
      .filter((t) => t.length > 0);
    if (cTokens.length === 0) return;
    let total = 0;
    let ok = true;
    for (const qt of qTokens) {
      const best = cTokens.reduce((acc, ct) => Math.max(acc, tokenScore(qt, ct)), 0);
      if (best <= 0) {
        ok = false;
        break;
      }
      total += best;
    }
    if (ok) scored.push({ name: candidate, score: total / qTokens.length, index });
  });
  return scored.sort((a, b) => (a.score < b.score ? 1 : a.score > b.score ? -1 : a.index - b.index)).map((x) => x.name);
}

/** 1 = exact/production match, else the best Jaro-Winkler (0 if below bar). */
function tokenScore(queryToken: string, candidateToken: string): number {
  const q = queryToken.trim();
  const c = candidateToken.trim();
  if (q.length === 0 || c.length === 0) return 0;
  const qAr = isArabicScript(q);
  const cAr = isArabicScript(c);
  if (qAr !== cAr) {
    const latin = qAr ? c : q;
    const arabic = qAr ? q : c;
    return latinMatchesArabic(latin, normalizeArabicName(arabic)) ? 1 : 0;
  }
  if (qAr && cAr) {
    const nq = normalizeArabicName(q);
    const nc = normalizeArabicName(c);
    if (nq === nc) return 1;
    const jw = jaroWinkler(nq, nc);
    return jw >= JW_ARABIC ? jw : 0;
  }
  if (q.toLowerCase() === c.toLowerCase()) return 1;
  const jw = jaroWinkler(q.toLowerCase(), c.toLowerCase());
  return jw >= JW_LATIN ? jw : 0;
}
