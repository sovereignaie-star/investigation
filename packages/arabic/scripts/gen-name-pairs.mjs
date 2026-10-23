#!/usr/bin/env node
// P5-006 — Arabic golden name set (2,000 pairs) -> fixtures/arabic/name-pairs.jsonl + manifest.json.
//
// Independence and honesty rules (same spirit as gen-golden.mjs):
// - the pair generator is SEEDED and deterministic: same seed → byte-identical output;
// - no real persons' data: names are common Arabic/Gulf given names and family names
//   (public common knowledge), combined deterministically — a pair is a construct,
//   not a person; the "no real persons" rule of §8.4 holds by construction;
// - the Jaro-Winkler here is a SECOND self-contained implementation used only to
//   verify that emitted UNMATCHED pairs are honestly separable (JW < 0.90 on the
//   Arabic side, below the matcher's 0.92 threshold) — lookalikes that the matcher
//   cannot separate (سعد/سعيد) are logged as "confusable" and documented, not emitted;
// - categories cover the D5 requirements: تطبيع، بن/ابن/بنت، أسماء مركبة (عبد)،
//   ألقاب ونسب، ترتيب، ترجمة عربي↔لاتيني.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "fixtures", "arabic");
const SEED = 0x0a2d06;
const TOTAL = 2000;

// ---------- PRNG (mulberry32) ----------
let state = SEED >>> 0;
const rnd = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (max) => Math.floor(rnd() * max);
const pick = (arr) => arr[int(arr.length)];

// ---------- second Jaro-Winkler implementation (separability check only) ----------
function jaro(a, b) {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aFlags = new Array(a.length).fill(false);
  const bFlags = new Array(b.length).fill(false);
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
  if (matches === 0) return 0;
  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < a.length; i++) {
    if (aFlags[i]) {
      while (!bFlags[k]) k++;
      if (a[i] !== b[k]) transpositions++;
      k++;
    }
  }
  return (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
}

function jaroWinkler(a, b) {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const j = jaro(a, b);
  if (j < 0.7) return j;
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  return j + prefix * 0.1 * (1 - j);
}

// ---------- name banks (common given/family names — public knowledge) ----------
// عبد compounds are handled as single units (عبدالله، عبدالعزيز...) plus spaced forms.
const MALE = [
  ["محمد", ["Mohammed", "Muhammad", "Mohamed", "Mohamad"]],
  ["أحمد", ["Ahmed", "Ahmad"]],
  ["عبدالله", ["Abdullah", "Abdallah"]],
  ["عبدالعزيز", ["Abdulaziz"]],
  ["عبدالرحمن", ["Abdulrahman"]],
  ["خالد", ["Khalid", "Khaled"]],
  ["سعد", ["Saad"]],
  ["فهد", ["Fahad", "Fahd"]],
  ["سلطان", ["Sultan"]],
  ["ناصر", ["Nasser"]],
  ["تركي", ["Turki"]],
  ["بندر", ["Bandar"]],
  ["فيصل", ["Faisal"]],
  ["ماجد", ["Majed", "Majid"]],
  ["وليد", ["Waleed", "Walid"]],
  ["عمر", ["Omar"]],
  ["يوسف", ["Yousef", "Youssef", "Yusuf"]],
  ["صالح", ["Saleh"]],
  ["حمد", ["Hamad"]],
  ["راشد", ["Rashid"]],
  ["سعيد", ["Saeed", "Said"]],
  ["عادل", ["Adel", "Adil"]],
  ["طارق", ["Tariq", "Tarek"]],
  ["ياسر", ["Yasser"]],
  ["سامي", ["Sami"]],
  ["نواف", ["Nawaf"]],
  ["فارس", ["Fares"]],
  ["مازن", ["Mazen"]],
  ["عساف", ["Assaf"]],
  ["مشعل", ["Mishaal"]],
  ["إبراهيم", ["Ibrahim"]],
  ["إسماعيل", ["Ismail"]],
  ["سعود", ["Saud"]],
  ["سلمان", ["Salman"]],
  ["سليمان", ["Suleiman"]],
];
const FEMALE = [
  ["نورة", ["Noura", "Nora"]],
  ["سارة", ["Sara", "Sarah"]],
  ["فاطمة", ["Fatima", "Fatimah"]],
  ["عائشة", ["Aisha", "Aysha"]],
  ["مريم", ["Mariam", "Maryam"]],
  ["هند", ["Hind"]],
  ["لطيفة", ["Latifa"]],
  ["الجوهرة", ["Aljohara"]],
  ["منيرة", ["Munira"]],
  ["أمل", ["Amal"]],
  ["ريم", ["Reem"]],
  ["لمى", ["Lama"]],
  ["دانة", ["Dana"]],
  ["حصة", ["Hessa"]],
  ["أسماء", ["Asma"]],
  ["نوف", ["Nouf"]],
  ["شهد", ["Shahad"]],
  ["غادة", ["Ghada"]],
  ["جواهر", ["Jawaher"]],
  ["موضي", ["Modhi"]],
];
const FAMILIES = [
  ["العتيبي", "Alotaibi"],
  ["القحطاني", "Alqahtani"],
  ["الحربي", "Alharbi"],
  ["الشمري", "Alshammari"],
  ["الدوسري", "Aldossari"],
  ["الغامدي", "Alghamdi"],
  ["الزهراني", "Alzahrani"],
  ["السبيعي", "Alsobaie"],
  ["المطيري", "Almutairi"],
  ["البلوي", "Albalawi"],
  ["العنزي", "Alanazi"],
  ["الخالدي", "Alkhalidi"],
  ["المالكي", "Almaliki"],
  ["العسيري", "Alasiri"],
  ["الرشيدي", "Alrashidi"],
  ["البقمي", "Albaqami"],
  ["العجمي", "Alajmi"],
  ["الفهد", "Alfahad"],
  ["الصالح", "Alsaleh"],
  ["السعيد", "Alsaeed"],
  ["الرشيد", "Alrashid"],
  ["الحمد", "Alhamad"],
];
const FIRSTS = [...MALE, ...FEMALE];
const MALE_AR = MALE.map((m) => m[0]);

// ---------- helpers ----------
const DIACRITICS = "ًٌٍَُِّْ";
const diacritize = (s) =>
  Array.from(s)
    .map((ch) => (rnd() < 0.3 ? ch + DIACRITICS[int(DIACRITICS.length)] : ch))
    .join("");
const swapTaaMarbouta = (s) => s.replace(/ة/g, "ه");
const swapAlefMaqsura = (s) => s.replace(/ى/g, "ي");
const stripHamza = (s) => s.replace(/[أإآ]/g, "ا");

/** إطار الصوامت اللاتيني — نفس مجموعة الحذف في هياكل المطابق (P5-006). */
const frame = (s) => s.replace(/[aeiouwy'`]/g, "");

const latinOf = (ar) => {
  for (const [a, lats] of FIRSTS) if (a === ar) return pick(lats);
  for (const [a, lat] of FAMILIES) if (a === ar) return lat;
  return ar;
};
const fullAr = (first, family, middle = null) => (middle ? `${first} ${middle} ${family}` : `${first} ${family}`);

const pairs = [];
const push = (a, b, match, category) => pairs.push({ id: pairs.length + 1, a, b, match, category });
const usedAB = new Set();
const dedupe = (a, b) => {
  const key = `${a}||${b}`;
  if (usedAB.has(key)) return false;
  usedAB.add(key);
  return true;
};

// ---------- category 1: orthographic (200, matched) ----------
const ORTHO_FNS = [diacritize, swapTaaMarbouta, swapAlefMaqsura, stripHamza];
for (let i = 0; i < 200; i++) {
  const first = pick(FIRSTS)[0];
  const [, famLat] = pick(FAMILIES);
  const famAr = FAMILIES.find((f) => f[1] === famLat)[0];
  const base = fullAr(first, famAr, rnd() < 0.4 ? pick(MALE_AR) : null);
  if (!dedupe(base, base)) {
    i--;
    continue;
  }
  push(base, ORTHO_FNS[int(ORTHO_FNS.length)](base), true, "orthographic");
}

// ---------- category 2: cross_script (300, matched) ----------
for (let i = 0; i < 300; i++) {
  const first = pick(FIRSTS)[0];
  const fam = pick(FAMILIES);
  const withNasab = rnd() < 0.3;
  const middleAr = rnd() < 0.3 ? pick(MALE_AR) : null;
  const firstLat = latinOf(first);
  const middleLat = middleAr ? latinOf(middleAr) : null;
  // «بن» للمذكر فقط (مراجعة لغوية: «مريم بن فلان» زوج غير صادق لغوياً)
  const maleFirst = pick(MALE)[0];
  const nasabFather = pick(MALE_AR);
  const ar = withNasab ? `${maleFirst} بن ${nasabFather} ${fam[0]}` : fullAr(first, fam[0], middleAr);
  const lat = withNasab
    ? `${latinOf(maleFirst)} bin ${latinOf(nasabFather)} ${fam[1]}`
    : middleLat
      ? `${firstLat} ${middleLat} ${fam[1]}`
      : `${firstLat} ${fam[1]}`;
  if (!dedupe(ar, lat)) {
    i--;
    continue;
  }
  push(ar, lat, true, "cross_script");
}

// ---------- category 3: nasab (150, matched) ----------
for (let i = 0; i < 150; i++) {
  const first = pick(FIRSTS)[0];
  const fam = pick(FAMILIES);
  const r = rnd();
  let a, b;
  if (r < 0.35) {
    const father = pick(MALE_AR);
    a = `${first} بن ${father}`;
    b = `${first} ابن ${father}`;
  } else if (r < 0.6) {
    // «بنت» للمؤنث فقط (وإلا فالزوج لغوياً غير صادق)
    const female = pick(FEMALE)[0];
    const father = pick(MALE_AR);
    const fatherLat = latinOf(father);
    a = `${female} بنت ${father}`;
    b = `${latinOf(female)} bint ${fatherLat}`;
  } else if (r < 0.8) {
    const father = pick(MALE_AR);
    const fatherLat = latinOf(father);
    const firstLat = latinOf(first);
    a = `${firstLat} bin ${fatherLat}`;
    b = `${firstLat} ibn ${fatherLat}`;
  } else {
    const father = pick(MALE_AR);
    const maleFirst = pick(MALE)[0];
    a = `${maleFirst} بن ${father} ${fam[0]}`;
    b = `${latinOf(maleFirst)} bin ${latinOf(father)} ${fam[1]}`;
  }
  if (!dedupe(a, b)) {
    i--;
    continue;
  }
  push(a, b, true, "nasab");
}

// ---------- category 4: ordering (100, matched) ----------
for (let i = 0; i < 100; i++) {
  const first = pick(FIRSTS)[0];
  const middle = pick(MALE_AR);
  const fam = pick(FAMILIES);
  const a = `${first} ${middle} ${fam[0]}`;
  const b = `${middle} ${first} ${fam[0]}`;
  if (!dedupe(a, b)) {
    i--;
    continue;
  }
  push(a, b, true, "ordering");
}

// ---------- category 5: subset (100, matched) ----------
for (let i = 0; i < 100; i++) {
  const first = pick(FIRSTS)[0];
  const middle = rnd() < 0.5 ? pick(MALE_AR) : null;
  const fam = pick(FAMILIES);
  const full = fullAr(first, fam[0], middle);
  const r = rnd();
  let part;
  if (r < 0.4) part = first;
  else if (r < 0.7) part = fam[0];
  else part = `${first} ${fam[0]}`;
  if (!dedupe(part, full)) {
    i--;
    continue;
  }
  push(part, full, true, "subset");
}

// ---------- category 6: latin_variant (150, matched) ----------
for (let i = 0; i < 150; i++) {
  const first = pick(FIRSTS);
  if (first[1].length < 2) {
    i--;
    continue;
  }
  const fam = pick(FAMILIES);
  const withMiddle = rnd() < 0.3;
  const middleLat = withMiddle ? latinOf(pick(MALE_AR)) : null;
  const a = `${first[1][0]}${middleLat ? " " + middleLat : ""} ${fam[1]}`;
  const b = `${first[1][int(first[1].length)]}${middleLat ? " " + middleLat : ""} ${fam[1]}`;
  if (a === b || !dedupe(a, b)) {
    i--;
    continue;
  }
  push(a, b, true, "latin_variant");
}

// ---------- category 7: compound_spacing (150, matched) ----------
const ABD = [
  ["عبدالله", "Abdullah", "Abdullah"],
  ["عبدالعزيز", "Abdulaziz", "Abdul Aziz"],
  ["عبدالرحمن", "Abdulrahman", "Abdul Rahman"],
];
for (let i = 0; i < 150; i++) {
  const [ar, lat, latSpaced] = pick(ABD);
  const fam = pick(FAMILIES);
  const spacedAr = ar.replace(/^(عبد)(.+)/, "عبد $2");
  const r = rnd();
  let a, b;
  if (r < 0.4) {
    a = `${spacedAr} ${fam[0]}`;
    b = `${ar} ${fam[0]}`;
  } else if (r < 0.7) {
    a = `${latSpaced} ${fam[1]}`;
    b = `${lat} ${fam[1]}`;
  } else {
    a = `${spacedAr} ${fam[0]}`;
    b = `${lat} ${fam[1]}`;
  }
  if (!dedupe(a, b)) {
    i--;
    continue;
  }
  push(a, b, true, "compound_spacing");
}

// ---------- category 8: different_person_same_family (300, unmatched) ----------
const confusable = [];
const separablePair = (f1, f2) => jaroWinkler(f1, f2) < 0.9;
for (let i = 0; i < 300; i++) {
  const f1 = pick(FIRSTS)[0];
  let f2 = pick(FIRSTS)[0];
  if (f1 === f2) {
    i--;
    continue;
  }
  if (!separablePair(f1, f2)) {
    confusable.push([f1, f2]);
    i--;
    continue;
  }
  const fam = pick(FAMILIES);
  const latinPair = rnd() < 0.2;
  const a = latinPair ? `${latinOf(f1)} ${fam[1]}` : fullAr(f1, fam[0]);
  const b = latinPair ? `${latinOf(f2)} ${fam[1]}` : fullAr(f2, fam[0]);
  // منطقة ملتبسة (إطارات صوامت متطابقة لاتينياً — Salem/Selim): لا حقيقة أرضية، تُستبعد وتوثق (L-74)
  if (latinPair && frame(latinOf(f1)) === frame(latinOf(f2))) {
    i--;
    continue;
  }
  if (!dedupe(a, b)) {
    i--;
    continue;
  }
  push(a, b, false, "different_person_same_family");
}

// ---------- category 9: different_person (350, unmatched) ----------
for (let i = 0; i < 350; i++) {
  const f1 = pick(FIRSTS)[0];
  let f2 = pick(FIRSTS)[0];
  if (f1 === f2 || !separablePair(f1, f2)) {
    i--;
    continue;
  }
  const fam1 = pick(FAMILIES);
  let fam2 = pick(FAMILIES);
  if (fam1[0] === fam2[0]) {
    i--;
    continue;
  }
  const latinPair = rnd() < 0.2;
  const a = latinPair ? `${latinOf(f1)} ${fam1[1]}` : fullAr(f1, fam1[0]);
  const b = latinPair ? `${latinOf(f2)} ${fam2[1]}` : fullAr(f2, fam2[0]);
  if (latinPair && frame(latinOf(f1)) === frame(latinOf(f2))) {
    i--;
    continue;
  }
  if (!dedupe(a, b)) {
    i--;
    continue;
  }
  push(a, b, false, "different_person");
}

// ---------- category 10: lookalike (100, unmatched) ----------
// deliberately confusable name PAIRS (sharing most letters) that are still
// honestly different names — verified separable (JW < 0.90); سعد/سعيد-style
// pairs the matcher cannot separate are logged, not emitted (documented limit).
const LOOKALIKE_AR = [
  ["حمد", "محمد"],
  ["سالم", "سليم"],
  ["عبدالله", "عبدالرحمن"],
  ["عبدالعزيز", "عبدالرحمن"],
  ["خالد", "وائل"],
  ["فهد", "فهد"],
  ["راشد", "رائد"],
  ["ماجد", "مازن"],
  ["عادل", "عاصم"],
  ["سامي", "سالم"],
  ["وليد", "وائل"],
  ["ياسر", "ناصر"],
  ["تركي", "بركة"],
  ["بندر", "منذر"],
];
for (let i = 0; i < 100; i++) {
  let [f1, f2] = pick(LOOKALIKE_AR);
  if (f1 === f2) {
    i--;
    continue;
  }
  if (!separablePair(f1, f2)) {
    confusable.push([f1, f2]);
    i--;
    continue;
  }
  const fam = pick(FAMILIES);
  const a = fullAr(f1, fam[0]);
  const b = fullAr(f2, fam[0]);
  if (!dedupe(a, b)) {
    i--;
    continue;
  }
  push(a, b, false, "lookalike");
}

// ---------- category 11: cross_script_different (100, unmatched) ----------
for (let i = 0; i < 100; i++) {
  const f1 = pick(FIRSTS)[0];
  let f2 = pick(FIRSTS)[0];
  if (f1 === f2 || !separablePair(f1, f2)) {
    i--;
    continue;
  }
  const fam1 = pick(FAMILIES);
  let fam2 = pick(FAMILIES);
  if (fam1[0] === fam2[0]) {
    i--;
    continue;
  }
  const a = fullAr(f1, fam1[0]);
  const b = `${latinOf(f2)} ${fam2[1]}`;
  if (!dedupe(a, b)) {
    i--;
    continue;
  }
  push(a, b, false, "cross_script_different");
}

// ---------- sanity + output ----------
if (pairs.length !== TOTAL) {
  console.error(`expected ${TOTAL} pairs, generated ${pairs.length}`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
const raw = pairs.map((p) => JSON.stringify(p)).join("\n") + "\n";
writeFileSync(path.join(OUT, "name-pairs.jsonl"), raw);
writeFileSync(
  path.join(OUT, "manifest.json"),
  JSON.stringify(
    {
      pairs: pairs.length,
      matched: pairs.filter((p) => p.match).length,
      unmatched: pairs.filter((p) => !p.match).length,
      sha256: createHash("sha256").update(raw).digest("hex"),
      seed: SEED,
    },
    null,
    2,
  ) + "\n",
);
const byCat = {};
for (const p of pairs) byCat[p.category] = (byCat[p.category] ?? 0) + 1;
console.log(
  `name-pairs: ${pairs.length} pairs (${pairs.filter((p) => p.match).length} matched / ${pairs.filter((p) => !p.match).length} unmatched)`,
);
console.log("categories:", JSON.stringify(byCat));
if (confusable.length > 0) {
  const uniq = [...new Set(confusable.map((c) => c.join(" / ")))];
  console.log(`matcher-confusable name pairs (NOT emitted, documented limit): ${uniq.length} unique — ${uniq.slice(0, 8).join("; ")}`);
}
