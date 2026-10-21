/**
 * P4-004 (ROADMAP 5.14 / D9) — the deterministic synthetic reference set.
 *
 * No labeled ER reference set exists in the repo (audited before writing this),
 * so the acceptance set is GENERATED — deterministic (seeded PRNG), labeled
 * (every pair is a true duplicate or a candidate non-match), and SPLIT into
 * train/eval: the m/u weights are estimated on train ONLY (the thresholds are
 * declared constants, never estimated); F1 is MEASURED on eval. HONESTY: the
 * generator itself was iterated after observing the DEVELOPMENT eval (seed 42)
 * — documented leakage (DECLARED_LIMITS L-45) — so acceptance is measured on
 * the FROZEN seed-1337 set that development never saw. Declared in
 * DECLARED_LIMITS.md: this measures the model on SYNTHETIC variation, not on
 * real-world dirty data.
 *
 * Variant design mirrors 5.14's comparison surface: name typos (after the first
 * 3 comparison-key chars — blocking keys must survive), Arabic fold spellings,
 * date format variants, address reorder/drop, and missing fields (never the
 * country — a missing country would break the spec's name3+country block key).
 * Hard negatives: siblings with the same first name and country, different
 * family name — they share a block and must NOT be suggested.
 */
import type { ErRecord, ReferencePair, ReferenceSet, ReferenceSplit } from "./types.ts";

/** Deterministic PRNG (mulberry32) — same seed, same set, always. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = [
  "محمد",
  "عبدالله",
  "أحمد",
  "خالد",
  "إبراهيم",
  "فاطمة",
  "نورة",
  "سعاد",
  "علي",
  "يوسف",
  "سارة",
  "منى",
  "عمر",
  "سلمان",
  "بدر",
  "هند",
  "ريم",
  "لمى",
  "طلال",
  "مشعل",
  "عبدالعزيز",
  "فهد",
  "سعود",
  "نايف",
  "راشد",
  "حمدان",
  "جواهر",
  "شهد",
  "غادة",
  "أمجد",
];
const FATHER = [
  "عبدالرحمن",
  "سعد",
  "فيصل",
  "بندر",
  "تركي",
  "ناصر",
  "ماجد",
  "وليد",
  "صالح",
  "حسن",
  "حسين",
  "عادل",
  "خالد",
  "سامي",
  "طاهر",
  "منصور",
  "فواز",
  "زيد",
  "رائد",
  "سلمان",
];
const FAMILY = [
  "السالم",
  "الحربي",
  "القحطاني",
  "الشمري",
  "العتيبي",
  "الدوسري",
  "المطيري",
  "الغامدي",
  "الزهراني",
  "البقمي",
  "السبيعي",
  "الرشيد",
  "الفهد",
  "الخالدي",
  "الصالح",
  "النعيمي",
  "الهاجري",
  "الكندي",
  "الفيفي",
  "السويلم",
  "الجابري",
  "العمري",
  "السهلي",
  "الودعاني",
  "المالكي",
];
const COMPANY = [
  "النور",
  "الريادة",
  "الأفق",
  "الوفاء",
  "المدار",
  "النخبة",
  "الرؤية",
  "السلام",
  "الإتقان",
  "الدرعية",
  "الصفا",
  "المروة",
  "الياسمين",
  "الزيتونة",
  "السدرة",
  "النخيل",
  "الجودة",
  "التميز",
  "الوسطى",
  "الشرقية",
];
const CITIES = ["الرياض", "جدة", "الدمام", "مكة", "المدينة", "أبوظبي", "القاهرة", "عمّان"];
const DISTRICTS = ["حي النرجس", "حي الملقا", "حي الشاطئ", "حي العليا", "حي المعادي", "حي عبدون"];
const COUNTRIES = ["SA", "EG", "JO", "AE", "KW"];

/** Arabic fold spellings — different spelling, SAME comparison key. */
function foldSpelling(name: string, r: () => number): string {
  const folds: Array<[RegExp, string]> = [
    [/ا/, "أ"],
    [/ة/, "هـ"],
    [/ي/, "ى"],
  ];
  const [re, to] = folds[Math.floor(r() * folds.length)];
  const i = name.search(re);
  return i === -1 ? name : name.slice(0, i) + to + name.slice(i + 1);
}

/** A typo AFTER the first 3 comparison-key characters (blocking keys survive). */
function typo(name: string, r: () => number): string {
  if (name.length < 5) return name;
  const i = 3 + Math.floor(r() * (name.length - 4));
  return r() < 0.5 ? name.slice(0, i) + name.slice(i + 1) : name.slice(0, i) + name[i + 1] + name[i] + name.slice(i + 2);
}

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Reformat a date: ISO ↔ DD/MM/YYYY ↔ bare year (5.14 date matching). */
function dateVariant(iso: string, r: () => number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const choice = r();
  if (choice < 0.4) return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
  if (choice < 0.7) return `${y}`;
  return iso;
}

interface Base {
  record: ErRecord;
  variants: ErRecord[];
  sibling: ErRecord | null;
}

/** One true-duplicate variant of a base record — mirrors 5.14's variation surface. */
function buildVariant(record: ErRecord, id: string, r: () => number): ErRecord {
  const name = r() < 0.5 ? foldSpelling(record.name, r) : typo(record.name, r);
  let birthDate = record.birthDate;
  if (birthDate !== undefined && r() < 0.5) birthDate = dateVariant(birthDate, r);
  let addresses = [...(record.addresses ?? [])];
  if (addresses.length > 0 && addresses[0].includes(" - ")) {
    if (r() < 0.5) {
      const parts = addresses[0].split(" - ");
      addresses = [`${parts[1]} - ${parts[0]}`];
    } else if (r() < 0.4) {
      addresses = [addresses[0].split(" - ")[0]];
    }
  }
  // drop a field (never country — the name3+country block key must survive)
  if (r() < 0.25) birthDate = undefined;
  if (r() < 0.2) addresses = [];
  const identifiers = r() < 0.2 ? [] : [...(record.identifiers ?? [])];
  return { ...record, id, name, birthDate, addresses, identifiers };
}

function buildBase(i: number, r: () => number): Base {
  const id = `ent-${String(i).padStart(4, "0")}`;
  const isCompany = r() < 0.3;
  const country = COUNTRIES[Math.floor(r() * COUNTRIES.length)];
  const y = 1940 + Math.floor(r() * 60);
  const date = isCompany ? `${y}` : isoDate(y, 1 + Math.floor(r() * 12), 1 + Math.floor(r() * 28));
  const city = CITIES[Math.floor(r() * CITIES.length)];
  const district = DISTRICTS[Math.floor(r() * DISTRICTS.length)];
  const address = `${city} - ${district}`;
  const identifier = r() < 0.6 ? (isCompany ? `cr:${100000 + i}` : `nat:${20000000 + i * 7}`) : undefined;

  const name = isCompany
    ? `شركة ${COMPANY[Math.floor(r() * COMPANY.length)]} للتجارة`
    : `${FIRST[Math.floor(r() * FIRST.length)]} ${FATHER[Math.floor(r() * FATHER.length)]} ${FAMILY[Math.floor(r() * FAMILY.length)]}`;

  const record: ErRecord = {
    id,
    name,
    country,
    birthDate: date,
    addresses: [address],
    identifiers: identifier ? [identifier] : [],
  };

  // variants (true duplicates) — 0 to 2
  const variants: ErRecord[] = [];
  const variantCount = r() < 0.65 ? (r() < 0.3 ? 2 : 1) : 0;
  for (let v = 0; v < variantCount; v++) variants.push(buildVariant(record, `${id}-v${v + 1}`, r));

  // hard-negative sibling: same first token, same country, different everything else
  let sibling: ErRecord | null = null;
  if (r() < 0.35) {
    const first = record.name.split(" ")[0];
    const other = isCompany
      ? `شركة ${COMPANY[Math.floor(r() * COMPANY.length)]} للمقاولات`
      : `${first} ${FATHER[Math.floor(r() * FATHER.length)]} ${FAMILY[Math.floor(r() * FAMILY.length)]}`;
    const sy = 1940 + Math.floor(r() * 60);
    sibling = {
      id: `${id}-s1`,
      name: other,
      country,
      birthDate: isCompany ? `${sy}` : isoDate(sy, 1 + Math.floor(r() * 12), 1 + Math.floor(r() * 28)),
      addresses: [`${CITIES[Math.floor(r() * CITIES.length)]} - ${DISTRICTS[Math.floor(r() * DISTRICTS.length)]}`],
      identifiers: isCompany ? [`cr:${300000 + i}`] : [`nat:${40000000 + i * 13}`],
    };
  }

  return { record, variants, sibling };
}

/**
 * Generates the reference set. Deterministic: the same seed always yields the
 * same set (T-ER-010 relies on this for determinism).
 */
export function generateReferenceSet(seed: number): ReferenceSet {
  const r = rng(seed);
  const bases: Base[] = [];
  for (let i = 0; i < 220; i++) bases.push(buildBase(i, r));

  const toSplit = (from: number, to: number): ReferenceSplit => {
    const records: ErRecord[] = [];
    const duplicatePairs: ReferencePair[] = [];
    for (let i = from; i < to; i++) {
      const b = bases[i];
      const cluster = [b.record, ...b.variants];
      if (b.sibling) cluster.push(b.sibling);
      records.push(...cluster);
      // every base/variant pair is a TRUE duplicate; sibling pairs are NEVER
      // duplicates (they are the hard negatives)
      for (let x = 0; x < cluster.length; x++) {
        for (let y = x + 1; y < cluster.length; y++) {
          const a = cluster[x];
          const c = cluster[y];
          if (a.id.endsWith("-s1") || c.id.endsWith("-s1")) continue;
          duplicatePairs.push({ a, b: c });
        }
      }
    }
    return { records, duplicatePairs };
  };

  return { train: toSplit(0, 110), eval: toSplit(110, 220) };
}
