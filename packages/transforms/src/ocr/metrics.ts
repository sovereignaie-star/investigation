/**
 * P5-024 — مقياس دقة OCR (معلن قبل القياس): مسافة تحرير على تسلسل الكلمات.
 *
 * الدقة = 1 − (بدائل + حذف + إضافات) / كلمات المرجع — لا «كيس كلمات»:
 * ترتيب الكلمات مُحترم، فالنص المعكوس يعاقَب والزيادات تُحسب.
 * التطبيع (يُطبق بالتساوي على المرجع والخرج): حذف التشكيل (\p{M}) والتطويل
 * (U+0640) وكل ما ليس حرفاً أو رقماً، وتوحيد الفراغات، وتوحيد الحالة للاتيني.
 */
export interface WordError {
  /** عدد كلمات المرجع. */
  readonly referenceWords: number;
  readonly substitutions: number;
  readonly deletions: number;
  readonly insertions: number;
  /** 1 − (S+D+I)/N — قد تكون سالبة عند خرج فاسد. */
  readonly accuracy: number;
}

/** التطبيع المعلن — حذف التشكيل والترقيم، وتوحيد الفراغات والحالة اللاتينية. */
export function normalizeWords(text: string): string[] {
  const stripped = text
    .replace(/\p{M}/gu, "") // التشكيل وأثره
    .replace(/\u0640/g, "") // التطويل
    .toLowerCase();
  const words = stripped.match(/[\p{L}\p{N}]+/gu);
  return words === null ? [] : words;
}

/**
 * مسافة تحرير على تسلسل الكلمات (Levenshtein كلاسيكي على مصفوفة الكلمات)
 * مع تتبع البدائل/الحذف/الإضافات من مصفوفة التتبع القياسية.
 */
export function wordAccuracy(reference: readonly string[], output: readonly string[]): WordError {
  const n = reference.length;
  const m = output.length;
  // مصفوفة المسافة القياسية (صفان للذاكرة)
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  let cur = new Array<number>(m + 1);
  // مصفوفة تتبع العملية: 0=مطابقة، 1=بديل، 2=حذف (من المرجع)، 3=إضافة
  const ops: number[][] = [Array.from({ length: m + 1 }, () => 3)];
  for (let i = 1; i <= n; i += 1) {
    cur[0] = i;
    const row: number[] = [2];
    for (let j = 1; j <= m; j += 1) {
      const cost = reference[i - 1] === output[j - 1] ? 0 : 1;
      const del = prev[j] + 1;
      const ins = cur[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      if (sub <= del && sub <= ins) {
        cur[j] = sub;
        row.push(cost === 0 ? 0 : 1);
      } else if (del <= ins) {
        cur[j] = del;
        row.push(2);
      } else {
        cur[j] = ins;
        row.push(3);
      }
    }
    ops.push(row);
    prev = cur;
    cur = new Array<number>(m + 1);
  }
  // إعادة البناء من نهاية المصفوفة (دالة مستقلة لقاعدة التعقيد)
  const { substitutions, deletions, insertions } = backtrackOps(ops, n, m);
  const errors = substitutions + deletions + insertions;
  return {
    referenceWords: n,
    substitutions,
    deletions,
    insertions,
    accuracy: n === 0 ? 0 : 1 - errors / n,
  };
}

/** يعدّ البدائل/الحذف/الإضافات بمسح مصفوفة التتبع من النهاية. */
function backtrackOps(ops: number[][], n: number, m: number): { substitutions: number; deletions: number; insertions: number } {
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const op = i > 0 ? ops[i][j] : 3;
    if (op === 0 || op === 1) {
      if (op === 1) substitutions += 1;
      i -= 1;
      j -= 1;
    } else if (op === 2) {
      deletions += 1;
      i -= 1;
    } else {
      insertions += 1;
      j -= 1;
    }
  }
  return { substitutions, deletions, insertions };
}
