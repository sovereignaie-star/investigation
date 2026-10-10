import { isRegistrableHost } from "../psl/index.ts";
import { base58CheckDecode } from "./base58.ts";
import { decodeBitcoinAddress } from "./bitcoin.ts";
import { checkEip55 } from "./eip55.ts";
import { checkIban } from "./iban.ts";
import { isIP, isIPv4, isIPv6 } from "./ip.ts";
import { luhn } from "./luhn.ts";

/**
 * Identifier validation (P1-005). `validate(type, normalized)` returns null when the type has no structural check, so
 * callers can tell "valid", "invalid" and "not checkable" apart; `validator` is the name stored in Identifier.validator
 * (packages/schema). Values are expected after `normalize()` (digits without separators, trimmed, etc.).
 */
export type Validation = { validator: string; valid: boolean; reason?: string; detail?: string };
type Check = (v: string) => Omit<Validation, "validator">;

const ok = (detail?: string) => (detail ? { valid: true, detail } : { valid: true });
const bad = (reason: string) => ({ valid: false, reason });

const card =
  (prefix: RegExp, lengths: number[]): Check =>
  (v) =>
    !/^\d+$/.test(v) || !lengths.includes(v.length) ? bad("length") : !prefix.test(v) ? bad("prefix") : luhn(v) ? ok() : bad("checksum");

const ipv4In =
  (name: string, test: (o: number[]) => boolean): Check =>
  (v) => {
    if (!isIPv4(v)) return bad("format");
    return test(v.split(".").map(Number)) ? ok() : bad(`not ${name}`);
  };

/** Base58Check altcoin addresses: accepted version bytes per type (payload is version + 20-byte hash). */
const base58Version =
  (versions: number[]): Check =>
  (v) => {
    const p = base58CheckDecode(v);
    if (!p) return bad("checksum");
    return p.length === 21 && versions.includes(p[0] ?? -1) ? ok() : bad("version");
  };

const evm: Check = (v) => {
  const r = checkEip55(v);
  return r.valid ? ok(r.checksummed ? "eip55" : "no-checksum") : bad(r.reason ?? "invalid");
};

const bitcoin =
  (kinds: string[]): Check =>
  (v) => {
    const a = decodeBitcoinAddress(v);
    if (!a) return bad("invalid");
    return kinds.includes(a.kind) ? ok(`${a.network}:${a.kind}`) : bad(`kind ${a.kind}`);
  };

/** ISO 6166 ISIN: letters expanded to two digits (A=10), then Luhn over the digit string. */
export function isValidIsin(v: string): boolean {
  if (!/^[A-Z]{2}[0-9A-Z]{9}\d$/.test(v)) return false;
  return luhn(Array.from(v, (c) => (c >= "A" ? String(c.charCodeAt(0) - 55) : c)).join(""));
}

const VALIDATORS: Record<string, [string, Check]> = {
  credit_card: ["luhn", card(/^\d/, [12, 13, 14, 15, 16, 17, 18, 19])],
  visa_card: ["luhn", card(/^4/, [13, 16, 19])],
  mastercard: ["luhn", card(/^(?:5[1-5]|222[1-9]|22[3-9]\d|2[3-6]\d\d|27[01]\d|2720)/, [16])],
  amex_card: ["luhn", card(/^3[47]/, [15])],
  imei: ["luhn", card(/^\d/, [15])],
  imei2: ["luhn", card(/^\d/, [15])],
  samsung_imei: ["luhn", card(/^\d/, [15])],
  iban: [
    "iban",
    (v) => {
      const r = checkIban(v);
      return r.valid ? ok(r.country) : bad(r.reason ?? "invalid");
    },
  ],
  isin: ["isin", (v) => (isValidIsin(v) ? ok() : bad("checksum"))],
  ethereum_address: ["eip55", evm],
  bnb_address: ["eip55", evm],
  nft_contract: ["eip55", evm],
  defi_pool: ["eip55", evm],
  bitcoin_address: ["bitcoin", bitcoin(["p2pkh", "p2sh", "segwit"])],
  bitcoin_address_p2sh: ["bitcoin", bitcoin(["p2sh"])],
  bitcoin_address_bech32: ["bitcoin", bitcoin(["segwit"])],
  litecoin_address: ["base58check", base58Version([0x30, 0x32, 0x05])],
  dogecoin_address: ["base58check", base58Version([0x1e, 0x16])],
  tron_address: ["base58check", base58Version([0x41])],
  ipv4: ["ip", (v) => (isIPv4(v) ? ok() : bad("format"))],
  ipv6: ["ip", (v) => (isIPv6(v) ? ok() : bad("format"))],
  ip_tor_exit: ["ip", (v) => (isIP(v) ? ok(`v${isIP(v)}`) : bad("format"))],
  vpn_ip: ["ip", (v) => (isIP(v) ? ok(`v${isIP(v)}`) : bad("format"))],
  multicast_ip: [
    "ip",
    (v) =>
      isIPv4(v)
        ? Number(v.split(".")[0]) >> 4 === 14
          ? ok()
          : bad("not multicast")
        : isIPv6(v)
          ? /^ff/i.test(v)
            ? ok()
            : bad("not multicast")
          : bad("format"),
  ],
  ip_private: ["ip", ipv4In("private", ([a = -1, b = -1]) => a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))],
  ipv4_loopback: ["ip", ipv4In("loopback", ([a]) => a === 127)],
  ipv4_apipa: ["ip", ipv4In("link-local", ([a, b]) => a === 169 && b === 254)],
  domain: ["psl", (v) => (isRegistrableHost(v) ? ok() : bad("not registrable"))],
  subdomain: ["psl", (v) => (isRegistrableHost(v) ? ok() : bad("not registrable"))],
  hostname: ["psl", (v) => (isRegistrableHost(v) ? ok() : bad("not registrable"))],
  mx_record: [
    "psl",
    (v) => {
      const m = /^(?:(\d{1,5}) )?(\S+)$/.exec(v);
      if (!m) return bad("format");
      if (m[1] !== undefined && Number(m[1]) > 65535) return bad("preference");
      return isRegistrableHost(m[2] ?? "") ? ok() : bad("not registrable");
    },
  ],
  smtp_server: ["psl", (v) => (isRegistrableHost(v) ? ok() : bad("not registrable"))],
};

export const VALIDATED_TYPES: readonly string[] = Object.keys(VALIDATORS);

export function validatorFor(type: string): string | null {
  return VALIDATORS[type]?.[0] ?? null;
}

export function validate(type: string, normalized: string): Validation | null {
  const entry = VALIDATORS[type];
  if (!entry) return null;
  return { validator: entry[0], ...entry[1](normalized) };
}

export * from "./base58.ts";
export * from "./bech32.ts";
export * from "./bitcoin.ts";
export * from "./eip55.ts";
export * from "./hash.ts";
export * from "./iban.ts";
export * from "./ip.ts";
export * from "./luhn.ts";
