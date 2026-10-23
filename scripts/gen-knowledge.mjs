/**
 * P5-009 — استخراج المعرفة من أصول بايثون القديمة إلى YAML بعد التنقية.
 *
 * يقرأ `attached_assets/legacy/` (لا يُستورد في أي كود — قيمتها معرفية لا برمجية،
 * جرد P0-016) ويستخرج آلياً بنود المعرفة القابلة للتعليم: تصنيفات التعدادات
 * والأصناف مع أوصافها من الملفات الصالحة (Investigation1/2/4)، ثم:
 *
 * 1. إزالة التكرار — بند بعنوان مكرر يُدمج (أول ظهور يفوز، موثق في السجل).
 * 2. التصنيف — كل بند «مقبول» أو «خارج الحدود» بسبب موثق من قواعد صريحة
 *    (keywords) — فاشل-مغلق: ما لم يصنف صراحةً يُعد خارج الحدود احتياطاً.
 * 3. الربط — المقبول الذي يتقاطع مع كتاب إجراءات يُربط بمعرّفه (PB-nn).
 * 4. التغطية — الملفات بلا معرفة قابلة للتعليم تُوثق في knowledge/EXEMPT.md
 *    بأسبابها (لا أن تُختفى).
 *
 * حتمي: نفس المدخلات تعطي نفس المخرجات (معرفات متسلسلة بترتيب ثابت).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEGACY = path.join(ROOT, "attached_assets", "legacy");
const OUT = path.join(ROOT, "knowledge");

/* ------------------------------------------------ استخراج بنود بايثون */

/** استخراج تعدادات (class X(Enum)) وأعضائها من ملف بايثون. */
function extractEnums(source) {
  const items = [];
  let currentEnum = null;
  for (const line of source.split("\n")) {
    const enumStart = line.match(/^class\s+(\S+?)\s*\(\s*Enum\s*\)\s*:/);
    if (enumStart !== null) {
      currentEnum = enumStart[1];
      continue;
    }
    if (/^class\s/.test(line)) {
      currentEnum = null;
      continue;
    }
    if (currentEnum !== null) {
      const member = line.match(/^\s{4}([^\s=]+)\s*=\s*\(\s*"(.*?)"\s*,\s*"(.*?)"\s*\)\s*$/);
      if (member !== null) {
        items.push({ title: member[2], description: member[3], origin: currentEnum, member: member[1] });
      }
    }
  }
  return items;
}

/** استخراج أصناف عادية (class X:) مع شرحها — اسم الصنف معرف المعرفة. */
function extractClasses(source) {
  const items = [];
  const clsRe = /^class\s+(\w+)[^(]*:\s*\n\s*"""([\s\S]*?)"""/gm;
  for (const cls of source.matchAll(clsRe)) {
    const [, className, docstring] = cls;
    const firstLine = docstring.trim().split("\n")[0].trim();
    if (firstLine.length > 0) items.push({ title: className, description: firstLine, origin: className, member: className });
  }
  return items;
}

/* ------------------------------------------------ قواعد التصنيف */

/** خارج الحدود — يفحص أولاً (احتياطي). كل قاعدة سببها موثق. */
const OUT_RULES = [
  { test: /humint|مصادر بشرية|تجنيد/i, reason: "استخبارات بشرية (HUMINT) — تجنيد مصادر بشرية خارج حدود المنتج الأخلاقية" },
  { test: /sigint|اعتراض|الكهرومغناطيسية/i, reason: "اعتراض إشارات (SIGINT) — خارج حدود المصادر المفتوحة المشروعة" },
  {
    test: /imint|elint|masint|cybint|quint|كمومي|تجسس/i,
    reason: "انضباط استخباراتي عدائي (IMINT/ELINT/MASINT/CYBINT/كمومي) — خارج نطاق أداة تحقيق دفاعية",
  },
  { test: /عسكري|military|weapon|أسلحة/i, reason: "تشفير عسكري/تسليح — خارج نطاق المنتج المدني" },
  { test: /dark|دارك|داكن|الويب المظلم/i, reason: "تشفير دارك ويب — خارج نطاق المصادر العامة" },
  { test: /biological|بيولوجي|neural|عصبي|scifi|خيال علمي/i, reason: "تشفير استشرافي (بيولوجي/عصبي/خيالي) — غير قابل للتعليم كمنهجية" },
  { test: /attacks?|هجمات|اختراق|اختراقات|هجوم/i, reason: "هجمات كسر تشفير — معرفة هجومية خارج حدود المنتج الدفاعي" },
  { test: /إخفاء المعلومات|steganograph/i, reason: "إخفاء معلومات — استخدام هجومي/إخفائي خارج المنهجية الدفاعية" },
  { test: /مصنف|سري\b|شديد الخصوصية|classified/i, reason: "مستويات سرية حكومية — لا صلة بمنتج مصادر مفتوحة" },
];

/** مقبول — منهجية مشروعة قابلة للتعليم؛ الربط بكتاب الإجراءات حيث يتقاطع. */
const IN_RULES = [
  { test: /osint|مفتوحة|المتاحة للعموم|مصادر معرفية/i, reason: "منهجية مصادر مفتوحة (OSINT) — أساس المنتج", playbook: "PB-01" },
  { test: /finint|مالي|اقتصاد|الأنماط الاقتصادية/i, reason: "تحليل مالي عام — يتقاطع مع فحص المحافظ الرقمية", playbook: "PB-03" },
  { test: /جغرافي|geoint|المكانية/i, reason: "تحليل جغرافي مكاني عام (خرائط عامة) — يدعم تحليل البنية", playbook: "PB-07" },
  { test: /hash|تجزئة/i, reason: "دوال التجزئة — أداة تحقق وتوثيق سلامة أساسية في المنتج", playbook: "PB-04" },
  { test: /بحث|منهج|توثيق|معرفي|مكتبة|معرفية/i, reason: "منهجية بحثية وتوثيقية قابلة للتعليم" },
];

const DEFAULT_OUT = {
  classification: "خارج الحدود",
  reason: "لم يطابق قواعد التصنيف الصريحة — خارج الحدود احتياطاً (فاشل-مغلق)",
};

function classify(item) {
  for (const rule of OUT_RULES) {
    if (rule.test.test(`${item.title} ${item.description}`)) {
      return { classification: "خارج الحدود", reason: rule.reason };
    }
  }
  for (const rule of IN_RULES) {
    if (rule.test.test(`${item.title} ${item.description}`)) {
      const result = { classification: "مقبول", reason: rule.reason };
      if (rule.playbook !== undefined) result.playbook = rule.playbook;
      return result;
    }
  }
  return { ...DEFAULT_OUT };
}

/* ------------------------------------------------ الملفات المستخرجة والمعفاة */

/** الملفات الصالحة للاستخراج الآلي — تصنيفات وأوصاف. */
const EXTRACTABLE = [
  { file: "Investigation1.py", enums: true, classes: false },
  { file: "Investigation2.py", enums: true, classes: false },
  { file: "Investigation4.py", enums: true, classes: true },
];

/** الملفات المعفاة من الاستخراج — تُوثق أسبابها في EXEMPT.md (لا أن تُختفى). */
const EXEMPT = [
  { file: "Investigation3.py", reason: "حدود منتج آخر (SOVRA) — كود أخلاقي لا منهجية قابلة للتعليم" },
  { file: "Investigation5.py", reason: "كود تطبيق (غرفة التحري) — لا معرفة تصنيفية" },
  { file: "Investigation6.py", reason: "قائمة معرفات — التصنيف الحقيقي يعيش في كتالوج @ir/schema (لا يُكرر هنا)" },
  { file: "Investigation7.py", reason: "كود جلب تطبيق — لا معرفة تصنيفية" },
  { file: "Investigation8.py", reason: "كود محرك تطبيق — لا معرفة تصنيفية" },
  { file: "Investigation9.py", reason: "ملف JSON (package.json من نسخة Next.js) — ليس معرفة" },
  { file: "Investigation10.py", reason: "كود إدارة مفاتيح تطبيق — لا معرفة تصنيفية" },
  { file: "Investigation11.py", reason: "كود قاعدة بيانات تطبيق — لا معرفة تصنيفية" },
  { file: "Investigation12.py", reason: "شجرة مجلدات نصية — ليس معرفة" },
  { file: "Investigation13.directions.py", reason: "وصف رؤية مشروع — لا منهجية قابلة للتعليم" },
  { file: "pasted-notes.txt", reason: "ملاحظات إرسال (برومبت بناء) — لا معرفة منهجية" },
];

/* ------------------------------------------------ YAML output helpers */

const y = (value) => JSON.stringify(String(value));
const sha256 = (file) =>
  createHash("sha256")
    .update(readFileSync(path.join(LEGACY, file)))
    .digest("hex");

function itemYaml(item, id) {
  const lines = [
    `    - id: ${item.id}`,
    `      title: ${y(item.title)}`,
    `      description: ${y(item.description)}`,
    `      classification: ${item.classification}`,
    `      reason: ${y(item.reason)}`,
  ];
  if (item.playbook !== undefined) lines.push(`      playbook: ${item.playbook}`);
  void id;
  return lines.join("\n");
}

/* ------------------------------------------------ التنفيذ */

mkdirSync(OUT, { recursive: true });
const seenTitles = new Set();
let nextId = 1;
const summary = [];

for (const source of EXTRACTABLE) {
  const content = readFileSync(path.join(LEGACY, source.file), "utf8");
  const extracted = [...(source.enums ? extractEnums(content) : []), ...(source.classes ? extractClasses(content) : [])];
  const kept = [];
  const deduped = [];
  for (const item of extracted) {
    const key = item.title.trim();
    if (seenTitles.has(key)) {
      deduped.push(`${key} (مكرر — حُذف)`);
      continue;
    }
    seenTitles.add(key);
    kept.push({ ...item, ...classify(item), id: `KN-${String(nextId).padStart(3, "0")}` });
    nextId += 1;
  }
  if (kept.length === 0) {
    summary.push(`${source.file}: 0 بنود بعد التنقية — لا ملف يُكتب (لا ملفات فارغة)`);
    continue;
  }
  const outName = source.file.replace(/\.py$/, "").toLowerCase().replace(/\..*$/, "") + ".yaml";
  const header = `# استُخرج آلياً من attached_assets/legacy/${source.file} (P5-009) — لا يُعدل يدوياً؛ عدّل scripts/gen-knowledge.mjs ثم أعد التوليد.\n# الأصل: ${extracted.length} بنداً؛ بعد التنقية (إزالة التكرار): ${kept.length}.\n`;
  const body = [
    header,
    `source:`,
    `  file: ${y(source.file)}`,
    `  sha256: ${sha256(source.file)}`,
    `items:`,
    kept.map((i) => itemYaml(i, i.id)).join("\n"),
    "",
  ].join("\n");
  writeFileSync(path.join(OUT, outName), body);
  summary.push(
    `${source.file}: ${extracted.length} مستخرجاً → ${kept.length} بعد التنقية${deduped.length > 0 ? ` (${deduped.length} مكرر حُذف: ${deduped.join("؛ ")})` : ""}`,
  );
}

const exemptBody = [
  "# ملفات بلا معرفة قابلة للتعليم — معفاة من الاستخراج وموثقة (P5-009)",
  "",
  "كل بند في جرد الأصول القديمة إما مستخرج إلى `knowledge/*.yaml` أو معفى أدناه بسبب موثق — لا ملف يختفي.",
  "",
  "| الملف | السبب |",
  "|---|---|",
  ...EXEMPT.map((e) => `| \`${e.file}\` | ${e.reason} |`),
  "",
].join("\n");
writeFileSync(path.join(OUT, "EXEMPT.md"), exemptBody);

console.log("P5-009 knowledge extraction:");
for (const line of summary) console.log(`  ${line}`);
console.log(`  EXEMPT.md: ${EXEMPT.length} ملفاً موثقاً`);
console.log(`  مجموع البنود: ${nextId - 1}`);
