/**
 * P1-007: normalization and canonical keys (ROADMAP 5.4, 5.6 stage 5; fixes D-020, D-021).
 *
 * canonicalKey(type, raw) = "<type>:<normalized>". The key is the full normalized value, never truncated or
 * character-substituted, so two different identifiers never share a key (D-021), and equivalent spellings of one
 * identifier ("Example.com." / "example.com") always do (D-020).
 */

const INVISIBLE = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
const ARABIC_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;

/** Unicode compatibility form, no invisible/bidi characters, trimmed. Applied to every type first. */
export function cleanText(raw: string): string {
  return raw.normalize("NFKC").replace(INVISIBLE, "").trim();
}

/** Arabic-Indic (U+0660..) and Extended Arabic-Indic (U+06F0..) digits to ASCII. */
export function asciiDigits(s: string): string {
  return s.replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) & 0xf) % 10));
}

export class NormalizeError extends Error {
  constructor(
    readonly type: string,
    readonly raw: string,
    reason: string,
  ) {
    super(`cannot normalize ${type}: ${reason}`);
    this.name = "NormalizeError";
  }
}

type Normalizer = (s: string, type: string) => string;

function fail(type: string, raw: string, reason: string): never {
  throw new NormalizeError(type, raw, reason);
}

/** Lowercase ASCII hostname: IDN to punycode (A-label), no trailing dot. */
export function normalizeHost(s: string, type = "domain"): string {
  const h = s.replace(/\.$/, "").toLowerCase();
  if (!h || /[\s/@:?#]/.test(h)) fail(type, s, "not a hostname");
  let ascii: string;
  try {
    ascii = new URL(`http://${h}/`).hostname;
  } catch {
    fail(type, s, "invalid hostname");
  }
  return ascii;
}

function ipv4(s: string, type: string): string {
  const parts = s.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) fail(type, s, "not dotted-quad IPv4");
  return parts.map((p) => String(Number(p))).join("."); // decimal octets, leading zeros dropped
}

function ipv6(s: string, type: string): string {
  const bare = s.replace(/^\[|\]$/g, "");
  if (!bare.includes(":")) fail(type, s, "not IPv6");
  try {
    return new URL(`http://[${bare}]/`).hostname.slice(1, -1); // RFC 5952 compressed, lowercase
  } catch {
    fail(type, s, "invalid IPv6");
  }
}

function ip(s: string, type: string): string {
  return s.includes(":") ? ipv6(s, type) : ipv4(s, type);
}

function cidr(s: string, type: string): string {
  const m = /^(.+)\/(\d{1,3})$/.exec(s);
  if (!m) fail(type, s, "not CIDR");
  const [, addr = "", len = ""] = m;
  const max = addr.includes(":") ? 128 : 32;
  if (Number(len) > max) fail(type, s, "prefix too long");
  return `${ip(addr, type)}/${Number(len)}`;
}

function email(s: string, type: string): string {
  const at = s.lastIndexOf("@");
  if (at <= 0 || at === s.length - 1 || /\s/.test(s)) fail(type, s, "not an email address");
  return `${s.slice(0, at).toLowerCase()}@${normalizeHost(s.slice(at + 1), type)}`;
}

function url(s: string, type: string): string {
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    try {
      u = new URL(`http://${s}`); // bare "example.com/path"
    } catch {
      fail(type, s, "not a URL");
    }
  }
  u.hash = ""; // fragments never reach the server
  return u.href; // lowercase scheme and host, punycode, default port removed, path percent-encoded
}

function mac(s: string, type: string): string {
  const hex = s.replace(/[\s:.-]/g, "").toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(hex)) fail(type, s, "not a 48-bit MAC");
  return hex.match(/../g)?.join(":") ?? hex;
}

function asn(s: string, type: string): string {
  const m = /^(?:as)?\s*(\d{1,10})$/i.exec(s);
  if (!m || Number(m[1]) > 4294967295) fail(type, s, "not an ASN");
  return `AS${Number(m[1])}`;
}

function phone(s: string, type: string): string {
  const t = asciiDigits(s).replace(/[\s().\-\u2010-\u2015]/g, "");
  const intl = t.startsWith("+") ? t.slice(1) : t.startsWith("00") ? t.slice(2) : null;
  const digits = intl ?? t;
  if (!/^\d{4,17}$/.test(digits)) fail(type, s, "not a phone number");
  return intl === null ? digits : `+${digits}`; // full E.164 with country inference comes with libphonenumber (TR-036)
}

const lowerHex: Normalizer = (s, type) => {
  const h = s
    .replace(/^0x/i, "")
    .replace(/[\s:-]/g, "")
    .toLowerCase();
  if (!/^[0-9a-f]+$/.test(h)) fail(type, s, "not hexadecimal");
  return h;
};

const evmAddress: Normalizer = (s, type) => {
  const h = s.replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(h)) fail(type, s, "not a 20-byte address");
  return `0x${h}`; // EIP-55 checksum is validated in P1-005; the key is case-insensitive
};

const bech32: Normalizer = (s, type) => {
  if (s !== s.toLowerCase() && s !== s.toUpperCase()) fail(type, s, "mixed-case bech32 is invalid");
  return s.toLowerCase();
};

const upperCompact: Normalizer = (s) => asciiDigits(s).replace(/[\s-]/g, "").toUpperCase();
const digitsOnly: Normalizer = (s, type) => {
  const d = asciiDigits(s).replace(/[\s-]/g, "");
  if (!/^\d+$/.test(d)) fail(type, s, "expected digits");
  return d;
};
const handle: Normalizer = (s) => s.replace(/^@/, "").toLowerCase();
const lower: Normalizer = (s) => s.toLowerCase();
const exact: Normalizer = (s) => s; // case-sensitive encodings (base58, base64, secrets)
const text: Normalizer = (s) => s.replace(/\s+/g, " ");

const EXACT: Record<string, Normalizer> = {
  ipv4,
  ip_private: ipv4,
  ip_tor_exit: ip,
  vpn_ip: ip,
  ipv4_loopback: ipv4,
  ipv4_apipa: ipv4,
  multicast_ip: ip,
  ipv6,
  cidr,
  bgp_prefix: cidr,
  asn,
  mac_address: mac,
  wifi_bssid: mac,
  bluetooth_mac: mac,
  domain: normalizeHost,
  subdomain: normalizeHost,
  hostname: normalizeHost,
  mx_record: normalizeHost,
  smtp_server: normalizeHost,
  ens_name: lower,
  onion_v2: lower,
  onion_v3: lower,
  ethereum_address: evmAddress,
  bnb_address: evmAddress,
  nft_contract: evmAddress,
  defi_pool: evmAddress,
  bitcoin_address_bech32: bech32,
  cosmos_address: bech32,
  cardano_address: bech32,
  lightning_invoice: bech32,
  iban: upperCompact,
  swift_bic: upperCompact,
  lei_code: upperCompact,
  isin: upperCompact,
  vehicle_vin: upperCompact,
  stock_ticker: upperCompact,
  mrz_line: (s) => s.toUpperCase(),
  serial_number: upperCompact,
  engine_number: upperCompact,
  visa_number: upperCompact,
  credit_card: digitsOnly,
  visa_card: digitsOnly,
  mastercard: digitsOnly,
  amex_card: digitsOnly,
  credit_card_bin: digitsOnly,
  routing_number_us: digitsOnly,
  imei: digitsOnly,
  imei2: digitsOnly,
  samsung_imei: digitsOnly,
  imsi: digitsOnly,
  iccid: digitsOnly,
  pgp_fingerprint: lowerHex,
  ssl_cert_hash: lowerHex,
  uuid_v4: lower,
  uuid_v1: lower,
  ssdeep_hash: exact,
  bcrypt_hash: exact,
  ipfs_hash: exact,
  base64_encoded: exact,
  data_uri: exact,
  magnet_link: exact,
  text,
};

/** Families by type-id pattern, checked in order after EXACT. */
const FAMILIES: Array<[RegExp, Normalizer]> = [
  [/(?:^|_)(?:email|mail)$/, email],
  [/^email_/, email],
  [/^(?:gmail|protonmail|tutanota|outlook)$/, email],
  [/^phone_/, phone],
  [/_number$/, phone],
  [/(?:^|_)url$/, url],
  [/^url_/, url],
  [/^(?:ftp_url|ssh_url|git_repo|api_endpoint|websocket_url|rtmp_url|url_shortener)$/, url],
  [
    /^(?:md[45]_hash|sha\d+_hash|sha3_256|keccak256|crc32|tlsh|ripemd160|ntlm_hash|eth_tx_hash|crypto_tx_hash|bitcoin_block_hash|torrent_info_hash|file_hash_generic)$/,
    lowerHex,
  ],
  [/_hash$/, lowerHex],
  [/_(?:username|handle|user|tag)$/, handle],
  [/^(?:passport_|national_id_|driving_license_|tax_id_)/, upperCompact],
  [
    /^(?:iqama_sa|ssn_us|sin_ca|nino_uk|nif_es|cpf_br|cnpj_br|curp_mx|rfc_mx|aadhar_in|pan_in|nric_sg|mykad_my|ktp_id|snils_ru|inn_ru|iin_kz|my_number_jp|resident_reg_kr|medicare_au|tfn_au|visa_number)$/,
    upperCompact,
  ],
  [/^(?:jwt_token|bearer_token|hmac_signature|ssh_public_key|ssl_private_key|pgp_private_key|crypto_seed)$/, exact],
  [/(?:_token|_key|_secret|_sk|_pk|_sid)$/, exact],
  [/_(?:address|xpub)$/, exact],
  [/^bitcoin_address/, exact], // base58 and similar encodings are case-sensitive
];

const TYPE_ID = /^[a-z][a-z0-9_.-]*$/;

export function normalizerFor(type: string): Normalizer {
  const direct = EXACT[type];
  if (direct) return direct;
  for (const [re, fn] of FAMILIES) if (re.test(type)) return fn;
  return text;
}

/** Normalized value of `raw` as identifier `type`. Throws NormalizeError when the value cannot be that type. */
export function normalize(type: string, raw: string): string {
  if (!TYPE_ID.test(type)) throw new NormalizeError(type, raw, "invalid type id");
  const fn = normalizerFor(type);
  let s = cleanText(raw);
  if (fn !== text && fn !== exact) s = asciiDigits(s);
  if (!s) throw new NormalizeError(type, raw, "empty value");
  const out = fn(s, type);
  if (!out) throw new NormalizeError(type, raw, "empty after normalization");
  return out;
}

/** "<type>:<normalized>". Full value, no truncation, no substitution (D-021). */
export function canonicalKey(type: string, raw: string): string {
  return `${type}:${normalize(type, raw)}`;
}

/** Splits a canonical key back into its parts (the first ":" separates type from value). */
export function parseCanonicalKey(key: string): { type: string; normalized: string } {
  const i = key.indexOf(":");
  const type = key.slice(0, i);
  if (i <= 0 || !TYPE_ID.test(type) || i === key.length - 1) throw new TypeError(`not a canonical key: ${key}`);
  return { type, normalized: key.slice(i + 1) };
}
