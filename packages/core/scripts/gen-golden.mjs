#!/usr/bin/env node
// Golden set for identifier detection (P1-020) -> fixtures/detect/golden.jsonl + manifest.json.
//
// Independence: every checksum here (Luhn, IBAN mod-97, ISIN, Base58Check, Bech32, Keccak-256/EIP-55) is a second
// implementation, written without importing @ir/core, and self-checked against published vectors before any output.
// The test (packages/core/src/identifiers/golden.test.ts) is the second review: each label must also pass the core
// validators, and each near-miss must fail them. Deterministic (seeded); no real persons' data:
//   - cards use issuer test BINs (400000, 424242, 555555, 510510, 378282, 371449);
//   - phones use ranges reserved for fiction (Ofcom 07700 900xxx, NANP 555-01xx);
//   - addresses, hashes and domains come from random bytes / random labels;
//   - IPv6 uses 2001:db8::/32 (RFC 3849), public IPv4 uses the documentation ranges (RFC 5737).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "fixtures", "detect");
const SEED = 0x1d2020;
const TOTAL = 5000;
const NEGATIVE_SHARE = 0.16;

// ---------- PRNG (mulberry32) ----------
let state = SEED >>> 0;
const rnd = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (a) => a[Math.floor(rnd() * a.length)];
const digits = (n) => Array.from({ length: n }, () => int(0, 9)).join("");
const bytes = (n) => Uint8Array.from({ length: n }, () => int(0, 255));
const hex = (b) => Buffer.from(b).toString("hex");
const assert = (c, m) => {
  if (!c) throw new Error(`self-check failed: ${m}`);
};

// ---------- independent checksum implementations ----------
const luhnDigit = (body) => {
  let s = 0;
  for (let i = 0; i < body.length; i++) {
    let d = Number(body[body.length - 1 - i]);
    if (i % 2 === 0) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    s += d;
  }
  return String((10 - (s % 10)) % 10);
};
const luhnOk = (n) => luhnDigit(n.slice(0, -1)) === n.at(-1);

const toDigits = (s) => [...s].map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c)).join("");
const mod97 = (s) => [...s].reduce((r, c) => (r * 10 + Number(c)) % 97, 0);
const iban = (cc, bban) => {
  const check = String(98 - mod97(toDigits(`${bban}${cc}00`))).padStart(2, "0");
  return `${cc}${check}${bban}`;
};
const ibanOk = (s) => mod97(toDigits(s.slice(4) + s.slice(0, 4))) === 1;

const isinCheck = (body) => luhnDigit(toDigits(body));

const sha256 = (b) => createHash("sha256").update(b).digest();
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const b58 = (buf) => {
  let x = BigInt(`0x${hex(buf) || "0"}`);
  let out = "";
  while (x > 0n) {
    out = B58[Number(x % 58n)] + out;
    x /= 58n;
  }
  for (const b of buf) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
};
const b58check = (version, payload) => {
  const body = Buffer.concat([Buffer.from([version]), Buffer.from(payload)]);
  return b58(Buffer.concat([body, sha256(sha256(body)).subarray(0, 4)]));
};

const BECH = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const polymod = (values) => {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= G[i];
  }
  return chk >>> 0;
};
const hrpExpand = (h) => [...[...h].map((c) => c.charCodeAt(0) >> 5), 0, ...[...h].map((c) => c.charCodeAt(0) & 31)];
const bits8to5 = (b) => {
  let acc = 0,
    n = 0;
  const out = [];
  for (const x of b) {
    acc = (acc << 8) | x;
    n += 8;
    while (n >= 5) {
      n -= 5;
      out.push((acc >> n) & 31);
    }
  }
  if (n > 0) out.push((acc << (5 - n)) & 31);
  return out;
};
const segwitV0 = (hrp, program) => {
  const data = [0, ...bits8to5(program)];
  const mod = polymod([...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const chk = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...data, ...chk].map((d) => BECH[d]).join("")}`;
};

// Keccak-256 (original padding 0x01, as used by Ethereum), BigInt lanes.
const RC = [
  0x1n,
  0x8082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x808bn,
  0x80000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x8an,
  0x88n,
  0x80008009n,
  0x8000000an,
  0x8000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x80000001n,
  0x8000000080008008n,
];
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const M64 = (1n << 64n) - 1n;
const rotl = (x, n) => (n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M64);
function keccakF(A) {
  for (const rc of RC) {
    const C = [0, 1, 2, 3, 4].map((x) => A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20]);
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) A[x + y] ^= D;
    }
    const B = new Array(25);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(A[x + 5 * y], ROT[x + 5 * y]);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) A[x + 5 * y] = B[x + 5 * y] ^ (~B[((x + 1) % 5) + 5 * y] & M64 & B[((x + 2) % 5) + 5 * y]);
    A[0] ^= rc;
  }
}
function keccak256(msg) {
  const rate = 136;
  const m = Buffer.from(msg);
  const padLen = rate - (m.length % rate);
  const p = Buffer.concat([m, Buffer.alloc(padLen)]);
  p[m.length] ^= 0x01;
  p[p.length - 1] ^= 0x80;
  const A = new Array(25).fill(0n);
  for (let off = 0; off < p.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) A[i] ^= p.readBigUInt64LE(off + i * 8);
    keccakF(A);
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) out.writeBigUInt64LE(A[i], i * 8);
  return out.toString("hex");
}
const eip55 = (addrHex) => {
  const h = keccak256(Buffer.from(addrHex.toLowerCase(), "ascii"));
  return `0x${[...addrHex.toLowerCase()].map((c, i) => (/[a-f]/.test(c) && parseInt(h[i], 16) >= 8 ? c.toUpperCase() : c)).join("")}`;
};

// ---------- self-checks against published vectors ----------
assert(luhnOk("4111111111111111") && luhnOk("490154203237518"), "luhn");
assert(iban("DE", "370400440532013000") === "DE89370400440532013000", "iban DE (ECBS example)");
assert(iban("GB", "WEST12345698765432") === "GB82WEST12345698765432", "iban GB (ECBS example)");
assert(`US037833100${isinCheck("US037833100")}` === "US0378331005", "isin (Apple)");
assert(
  b58check(0, Buffer.from("62e907b15cbf27d5425399ebf6f0fb50ebb88f18", "hex")) === "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
  "base58check (genesis)",
);
assert(
  segwitV0("bc", Buffer.from("751e76e8199196d454941c45d1b3a323f1433bd6", "hex")) === "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
  "bech32 (BIP-173)",
);
assert(keccak256("") === "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470", "keccak256('')");
assert(eip55("de0b295669a9fd93d5f28d9ec85e40f4cb697bae") === "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe", "eip55 (EIP-55 vector)");

// ---------- value families ----------
// accept = the types a correct detector may report first: the declared type plus the types the catalog cannot tell
// apart from it by pattern+validator (D-007) or that it specialises (visa_card within credit_card).
const ETH = ["ethereum_address", "bnb_address", "nft_contract", "defi_pool"];
const IP4 = ["ipv4", "ip_tor_exit", "vpn_ip"];
const IMEI = ["imei", "imei2"];
const label = () =>
  pick(["nimbus", "qarawi", "falcon", "tarmac", "oasis", "zephyr", "marjan", "corvid", "lumen", "sahra"]) + digits(int(1, 3));
const sfx = () => pick(["com", "net", "org", "co.uk", "com.sa", "sa", "ae", "de", "io"]);
const BBAN = {
  DE: () => digits(18),
  GB: () => `${pick(["WEST", "NWBK", "BARC", "MIDL"])}${digits(14)}`,
  SA: () => digits(20),
  AE: () => digits(19),
  NL: () => `${pick(["ABNA", "INGB", "RABO"])}${digits(10)}`,
  FR: () => digits(23),
};
const card = (bin, len) => {
  const body = bin + digits(len - bin.length - 1);
  return body + luhnDigit(body);
};
const imeiOf = (tac) => {
  const body = tac + digits(14 - tac.length);
  return body + luhnDigit(body);
};

const DET = {
  ipv4_public: () => ({ value: `${pick(["192.0.2", "198.51.100", "203.0.113"])}.${int(1, 254)}`, type: "ipv4", accept: IP4 }),
  ip_private: () => ({
    value: pick([
      `10.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}`,
      `172.${int(16, 31)}.${int(0, 255)}.${int(1, 254)}`,
      `192.168.${int(0, 255)}.${int(1, 254)}`,
    ]),
    type: "ip_private",
    accept: ["ip_private", ...IP4],
  }),
  ipv4_loopback: () => ({
    value: `127.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}`,
    type: "ipv4_loopback",
    accept: ["ipv4_loopback", ...IP4],
  }),
  multicast_ip: () => ({
    value: `${int(224, 239)}.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}`,
    type: "multicast_ip",
    accept: ["multicast_ip", ...IP4],
  }),
  ipv4_apipa: () => ({ value: `169.254.${int(1, 254)}.${int(1, 254)}`, type: "ipv4_apipa", accept: ["ipv4_apipa", ...IP4] }),
  ipv6: () => {
    const g = Array.from({ length: 6 }, () => int(0, 0xffff).toString(16));
    return { value: rnd() < 0.5 ? `2001:db8:${g.join(":")}` : `2001:db8:${g[0]}::${g[1]}`, type: "ipv6", accept: ["ipv6"] };
  },
  iban: () => {
    const cc = pick(Object.keys(BBAN));
    return { value: iban(cc, BBAN[cc]()), type: "iban", accept: ["iban"] };
  },
  visa_card: () => ({ value: card(pick(["400000", "424242"]), 16), type: "visa_card", accept: ["visa_card", "credit_card"] }),
  mastercard: () => ({ value: card(pick(["555555", "510510"]), 16), type: "mastercard", accept: ["mastercard", "credit_card"] }),
  amex_card: () => ({ value: card(pick(["378282", "371449"]), 15), type: "amex_card", accept: ["amex_card", "credit_card"] }),
  isin: () => {
    const body =
      pick(["US", "GB", "SA", "DE", "FR"]) + Array.from({ length: 9 }, () => pick([..."0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"])).join("");
    return { value: body + isinCheck(body), type: "isin", accept: ["isin"] };
  },
  imei: () => ({ value: imeiOf(pick(["49", "86", "01"])), type: "imei", accept: IMEI }),
  samsung_imei: () => ({ value: imeiOf("35"), type: "samsung_imei", accept: ["samsung_imei", ...IMEI] }),
  bitcoin_address: () => ({ value: b58check(0x00, bytes(20)), type: "bitcoin_address", accept: ["bitcoin_address"] }),
  bitcoin_address_p2sh: () => ({
    value: b58check(0x05, bytes(20)),
    type: "bitcoin_address_p2sh",
    accept: ["bitcoin_address_p2sh", "litecoin_address"],
  }),
  bitcoin_address_bech32: () => ({ value: segwitV0("bc", bytes(20)), type: "bitcoin_address_bech32", accept: ["bitcoin_address_bech32"] }),
  litecoin_address: () => ({ value: b58check(0x30, bytes(20)), type: "litecoin_address", accept: ["litecoin_address"] }),
  dogecoin_address: () => ({ value: b58check(0x1e, bytes(20)), type: "dogecoin_address", accept: ["dogecoin_address"] }),
  tron_address: () => ({ value: b58check(0x41, bytes(20)), type: "tron_address", accept: ["tron_address"] }),
  ethereum_address: () => ({ value: eip55(hex(bytes(20))), type: "ethereum_address", accept: ETH }),
  domain: () => ({ value: `${label()}.${sfx()}`, type: "domain", accept: ["domain"] }),
  subdomain: () => ({
    value: `${pick(["api", "cdn", "portal", "vpn", "static"])}.${label()}.${sfx()}`,
    type: "subdomain",
    accept: ["subdomain", "hostname"],
  }),
  smtp_server: () => ({
    value: `${pick(["smtp", "mail"])}.${label()}.${sfx()}`,
    type: "smtp_server",
    accept: ["smtp_server", "subdomain", "hostname"],
  }),
};
const NONDET = {
  email: () => ({
    value: `${pick(["info", "ops", "a.salem", "m_khalid", "noc"])}${digits(2)}@${label()}.${pick(["com", "net", "org", "sa"])}`,
    type: "email",
    accept: ["email", "email_corporate"],
  }),
  gmail: () => ({ value: `${label()}.${digits(3)}@gmail.com`, type: "gmail", accept: ["gmail", "email"] }),
  mac_address: () => ({
    value: Array.from({ length: 6 }, () => hex([int(0, 255)]))
      .join(pick([":", "-"]))
      .toUpperCase(),
    type: "mac_address",
    accept: ["mac_address", "bluetooth_mac"],
  }),
  md5_hash: () => ({ value: createHash("md5").update(bytes(16)).digest("hex"), type: "md5_hash", accept: ["md5_hash"] }),
  sha1_hash: () => ({ value: createHash("sha1").update(bytes(16)).digest("hex"), type: "sha1_hash", accept: ["sha1_hash"] }),
  sha256_hash: () => ({ value: createHash("sha256").update(bytes(16)).digest("hex"), type: "sha256_hash", accept: ["sha256_hash"] }),
  url: () => ({
    value: `https://${label()}.${pick(["com", "net", "org"])}/${pick(["login", "files", "p", "track"])}/${digits(4)}`,
    type: "url",
    accept: ["url", "url_https"],
  }),
  phone_uk: () => ({ value: `+447700900${digits(3)}`, type: "phone_uk", accept: ["phone_uk"] }),
  phone_us: () => ({ value: `+1-${pick(["202", "312", "415"])}-555-01${digits(2)}`, type: "phone_us", accept: ["phone_us"] }),
};

// ---------- near misses: same shape, broken checksum ----------
const bump = (s, i) => s.slice(0, i) + String((Number(s[i]) + 1) % 10) + s.slice(i + 1);
const swapB58 = (s) => {
  const i = int(5, s.length - 2);
  const c = s[i] === "z" ? "y" : B58[B58.indexOf(s[i]) + 1];
  return s.slice(0, i) + c + s.slice(i + 1);
};
const NEAR = {
  iban: () => {
    const v = DET.iban().value;
    return { value: bump(v, 3), reject: ["iban"] };
  },
  card: () => {
    const v = DET.visa_card().value;
    return { value: bump(v, v.length - 1), reject: ["visa_card", "credit_card"] };
  },
  isin: () => {
    const v = DET.isin().value;
    return { value: bump(v, v.length - 1), reject: ["isin"] };
  },
  imei: () => {
    const v = DET.imei().value;
    return { value: bump(v, v.length - 1), reject: IMEI };
  },
  btc: () => ({ value: swapB58(DET.bitcoin_address().value), reject: ["bitcoin_address"] }),
  tron: () => ({ value: swapB58(DET.tron_address().value), reject: ["tron_address"] }),
  bech32: () => {
    const v = DET.bitcoin_address_bech32().value;
    const i = int(6, v.length - 2);
    return { value: v.slice(0, i) + BECH[(BECH.indexOf(v[i]) + 1) % 32] + v.slice(i + 1), reject: ["bitcoin_address_bech32"] };
  },
  eth: () => {
    let v;
    do v = DET.ethereum_address().value;
    while (!/[a-fA-F]/.test(v.slice(2)));
    const i = 2 + [...v.slice(2)].findIndex((c) => /[a-fA-F]/.test(c));
    const c = v[i];
    return { value: v.slice(0, i) + (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()) + v.slice(i + 1), reject: ETH };
  },
  ipv4: () => ({ value: `${int(256, 999)}.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}`, reject: IP4 }),
};

// ---------- snippets ----------
const CTX = {
  ipv4_public: ["IP", "عنوان IP", "address"],
  ip_private: ["الشبكة الداخلية", "LAN host"],
  ipv4_loopback: ["loopback"],
  multicast_ip: ["multicast"],
  ipv4_apipa: ["link-local"],
  ipv6: ["IPv6"],
  iban: ["IBAN", "آيبان", "الحساب البنكي"],
  visa_card: ["بطاقة Visa", "card"],
  mastercard: ["Mastercard", "بطاقة"],
  amex_card: ["Amex", "بطاقة"],
  isin: ["ISIN", "السهم"],
  imei: ["IMEI", "الجهاز"],
  samsung_imei: ["IMEI", "Samsung"],
  bitcoin_address: ["بيتكوين", "BTC"],
  bitcoin_address_p2sh: ["BTC multisig", "بيتكوين"],
  bitcoin_address_bech32: ["bech32", "بيتكوين"],
  litecoin_address: ["Litecoin", "LTC"],
  dogecoin_address: ["Dogecoin", "DOGE"],
  tron_address: ["TRON", "USDT TRC-20"],
  ethereum_address: ["Ethereum", "محفظة ETH"],
  domain: ["النطاق", "domain"],
  subdomain: ["subdomain", "النطاق الفرعي"],
  smtp_server: ["SMTP", "خادم البريد"],
  email: ["email", "البريد"],
  gmail: ["Gmail", "البريد"],
  mac_address: ["MAC", "عنوان MAC"],
  md5_hash: ["MD5", "بصمة الملف"],
  sha1_hash: ["SHA-1", "بصمة"],
  sha256_hash: ["SHA-256", "بصمة الملف"],
  url: ["الرابط", "link"],
  phone_uk: ["UK phone", "هاتف"],
  phone_us: ["US phone", "هاتف"],
};
const AR = [
  "ظهر {x} {v} في السجلات",
  "تم رصد {x} {v} أثناء التحقيق",
  "راجع {x}: {v}",
  "المعرّف {v} مذكور في التقرير",
  "القيمة {v} وردت مرتين",
  "تحويل إلى {x} {v} مساء الخميس",
];
const EN = [
  "Observed {x} {v} in the logs.",
  "The report lists {x}: {v}",
  "Seen {v} twice yesterday",
  "Please check {x} {v} before Monday.",
  "Value {v} came from the export",
];
const FILL = { ar: ["ثم انتهت الجلسة.", "حسب المصدر.", ""], en: ["and the session closed.", "per the ticket.", ""] };

function snippet(families, near) {
  const lang = rnd() < 0.55 ? "ar" : "en";
  let text = "";
  const entities = [],
    negatives = [];
  const place = (piece, value) => {
    const [pre, post] = piece.split("{v}");
    text += (text ? " " : "") + pre;
    const start = text.length;
    text += value + post;
    return { start, end: start + value.length };
  };
  for (const [fam, gen] of families) {
    const e = gen();
    const neutral = rnd() < 0.3; // no type hint at all: the value has to speak for itself
    const tpl = pick(lang === "ar" ? AR : EN)
      .replace("{x}", neutral ? "" : pick(CTX[fam] ?? [""]))
      .replace(/ {2,}/g, " ")
      .replace(" :", ":");
    entities.push({ ...place(tpl, e.value), value: e.value, type: e.type, accept: e.accept, family: fam });
  }
  if (near) {
    const n = near[1]();
    negatives.push({
      ...place(lang === "ar" ? "وأيضاً {v} (غير صالح)" : "also {v} (invalid)", n.value),
      value: n.value,
      reject: n.reject,
      family: near[0],
    });
  }
  const f = pick(FILL[lang]);
  if (f) text += ` ${f}`;
  return { lang, text, entities, negatives };
}

const det = Object.entries(DET),
  nondet = Object.entries(NONDET),
  near = Object.entries(NEAR);
const rows = [];
const counts = { deterministic: {}, other: {}, near: {} };
for (let i = 0; i < TOTAL; i++) {
  const isNeg = i >= TOTAL * (1 - NEGATIVE_SHARE);
  // round-robin first entity so every family is well represented, then random extras
  const first = i % 3 === 2 ? nondet[i % nondet.length] : det[i % det.length];
  const fams = [first, ...Array.from({ length: int(0, isNeg ? 1 : 2) }, () => (rnd() < 0.7 ? pick(det) : pick(nondet)))];
  const s = snippet(fams, isNeg ? near[i % near.length] : null);
  for (const e of s.entities) {
    const bucket = DET[e.family] ? counts.deterministic : counts.other;
    bucket[e.family] = (bucket[e.family] ?? 0) + 1;
    // generator-side check of its own output
    if (["iban"].includes(e.family)) assert(ibanOk(e.value), e.value);
    if (/card|imei/.test(e.family)) assert(luhnOk(e.value), e.value);
  }
  for (const n of s.negatives) counts.near[n.family] = (counts.near[n.family] ?? 0) + 1;
  rows.push({ id: `det-${String(i + 1).padStart(4, "0")}`, ...s });
}

const jsonl = `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;
// --check: regenerate in memory and compare with the committed file (reproducibility, used by the test)
if (process.argv.includes("--check")) {
  const same = readFileSync(path.join(OUT, "golden.jsonl"), "utf8") === jsonl;
  process.stdout.write(same ? "golden: reproducible\n" : "golden: committed file differs from generator output\n");
  process.exit(same ? 0 : 1);
}
writeFileSync(path.join(OUT, "golden.jsonl"), jsonl);
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const manifest = {
  name: "detect-golden",
  task: "P1-020",
  version: 1,
  seed: SEED,
  snippets: rows.length,
  entities: { deterministic: sum(counts.deterministic), other: sum(counts.other) },
  nearMisses: sum(counts.near),
  families: counts,
  sha256: createHash("sha256").update(jsonl).digest("hex"),
  generator: "packages/core/scripts/gen-golden.mjs",
  review: "second review = packages/core/src/identifiers/golden.test.ts (independent core validators must agree with every label)",
};
writeFileSync(path.join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `golden: ${rows.length} snippets, ${manifest.entities.deterministic} deterministic + ${manifest.entities.other} other entities, ${manifest.nearMisses} near misses`,
);
