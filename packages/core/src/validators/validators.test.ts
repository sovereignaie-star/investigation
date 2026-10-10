import { createHash } from "node:crypto";
import { isIP as nodeIsIP } from "node:net";
import { describe, expect, it } from "vitest";
import bip173 from "./vectors/bip173.json" with { type: "json" };
import bip350 from "./vectors/bip350.json" with { type: "json" };
import base58Vectors from "./vectors/bitcoin_base58_encode_decode.json" with { type: "json" };
import keyIoInvalid from "./vectors/bitcoin_key_io_invalid.json" with { type: "json" };
import keyIoValid from "./vectors/bitcoin_key_io_valid.json" with { type: "json" };
import {
  base58Decode,
  base58Encode,
  bech32Decode,
  checkEip55,
  checkIban,
  decodeBitcoinAddress,
  decodeSegwitAddress,
  isIPv4,
  isIPv6,
  isValidIsin,
  keccak256,
  luhn,
  sha256,
  sha3_256,
  toChecksumAddress,
  toHex,
  utf8,
  validate,
  validatorFor,
} from "./index.ts";

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 131 + 7) & 0xff);

describe("hash primitives", () => {
  it("SHA-256 FIPS 180-4 vectors and node:crypto across block boundaries", () => {
    expect(toHex(sha256(utf8("abc")))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(toHex(sha256(utf8("")))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    for (const n of [1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
      expect(toHex(sha256(bytes(n)))).toBe(createHash("sha256").update(bytes(n)).digest("hex"));
    }
  });
  it("Keccak-256 known vectors; the shared permutation matches node:crypto SHA3-256 across rate boundaries", () => {
    expect(toHex(keccak256(utf8("")))).toBe("c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
    expect(toHex(keccak256(utf8("abc")))).toBe("4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
    for (const n of [0, 1, 135, 136, 137, 271, 272, 1000]) {
      expect(toHex(sha3_256(bytes(n)))).toBe(createHash("sha3-256").update(bytes(n)).digest("hex"));
    }
  });
});

describe("Luhn, IBAN, ISIN", () => {
  it("Luhn: ISO/IEC 7812 example and published test card numbers", () => {
    for (const v of ["79927398713", "4111111111111111", "5555555555554444", "378282246310005", "490154203237518"])
      expect(luhn(v), v).toBe(true);
    for (const v of ["79927398710", "4111111111111112", "", "12a4"]) expect(luhn(v), v).toBe(false);
  });
  it("Luhn detects every single-digit substitution", () => {
    const v = "4111111111111111";
    for (let i = 0; i < v.length; i++)
      for (let d = 0; d <= 9; d++) {
        if (String(d) === v.charAt(i)) continue;
        expect(luhn(v.slice(0, i) + d + v.slice(i + 1))).toBe(false);
      }
  });
  it("IBAN: registry examples pass; country, length, BBAN and checksum failures are distinguished", () => {
    for (const v of [
      "GB82 WEST 1234 5698 7654 32",
      "DE89370400440532013000",
      "SA0380000000608010167519",
      "FR1420041010050500013M02606",
      "NL91ABNA0417164300",
      "BE68539007547034",
      "AE070331234567890123456",
      "ae07 0331 2345 6789 0123 456",
    ])
      expect(checkIban(v), v).toMatchObject({ valid: true });
    expect(checkIban("GB82WEST12345698765431").reason).toBe("checksum");
    expect(checkIban("XX82WEST12345698765432").reason).toBe("country");
    expect(checkIban("GB82WEST1234569876543").reason).toBe("length");
    expect(checkIban("GB82WES112345698765432").reason).toBe("bban");
    expect(checkIban("not an iban").reason).toBe("format");
  });
  it("IBAN mod-97 detects every single-character substitution", () => {
    const v = "SA0380000000608010167519";
    for (let i = 2; i < v.length; i++)
      for (const c of "0123456789") {
        if (c === v.charAt(i)) continue;
        expect(checkIban(v.slice(0, i) + c + v.slice(i + 1)).valid).toBe(false);
      }
  });
  it("ISIN (ISO 6166)", () => {
    for (const v of ["US0378331005", "AU0000XVGZA3", "GB0002634946", "SA0007879113"]) expect(isValidIsin(v), v).toBe(true);
    for (const v of ["US0378331006", "us0378331005", "US037833100"]) expect(isValidIsin(v), v).toBe(false);
  });
});

describe("EIP-55", () => {
  const normal = [
    "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
    "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
    "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
  ];
  it("EIP-55 test cases: normal addresses round-trip, all-caps and all-lower are valid without checksum", () => {
    for (const a of normal) {
      expect(toChecksumAddress(a.toLowerCase())).toBe(a);
      expect(checkEip55(a)).toEqual({ valid: true, checksummed: true });
    }
    for (const a of [
      "0x52908400098527886E0F7030069857D2E4169EE7",
      "0x8617E340B3D01FA5F11F306F4090FD50E238070D",
      "0xde709f2102306220921060314715629080e2fb77",
      "0x27b1fdb04752bbc536007a920d24acb045561c26",
    ])
      expect(checkEip55(a)).toEqual({ valid: true, checksummed: false });
  });
  it("every single case flip of a checksummed address is rejected", () => {
    for (const a of normal)
      for (let i = 2; i < a.length; i++) {
        const c = a.charAt(i);
        if (!/[a-fA-F]/.test(c)) continue;
        const flipped = a.slice(0, i) + (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()) + a.slice(i + 1);
        const r = checkEip55(flipped);
        if (flipped.slice(2) === flipped.slice(2).toLowerCase() || flipped.slice(2) === flipped.slice(2).toUpperCase()) continue;
        expect(r.valid, flipped).toBe(false);
      }
  });
});

describe("Base58 and Bitcoin addresses (Bitcoin Core test data)", () => {
  it("base58_encode_decode.json round-trips", () => {
    for (const [hex, b58] of base58Vectors as [string, string][]) {
      const raw = Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
      expect(base58Encode(raw)).toBe(b58);
      expect(toHex(base58Decode(b58) ?? new Uint8Array([0xff]))).toBe(hex.toLowerCase());
    }
  });
  it("key_io_valid.json: every address decodes to its scriptPubKey on the right network", () => {
    const net = { main: "main", testnet4: "test", signet: "test", test: "test", regtest: "regtest" } as Record<string, string>;
    let n = 0;
    for (const [addr, spk, meta] of keyIoValid as [string, string, { chain: string }][]) {
      const a = decodeBitcoinAddress(addr);
      expect(a?.scriptPubKey, addr).toBe(spk);
      const expected = net[meta.chain];
      // regtest shares base58 prefixes with testnet; only its bech32 HRP differs
      expect(a?.network === expected || (meta.chain === "regtest" && a?.kind !== "segwit" && a?.network === "test"), addr).toBe(true);
      n++;
    }
    expect(n).toBe(54);
  });
  it("key_io_invalid.json: no entry decodes as an address", () => {
    for (const [s] of keyIoInvalid as [string][]) expect(decodeBitcoinAddress(s), s).toBeNull();
  });
});

describe("Bech32 / Bech32m (BIP-173, BIP-350)", () => {
  it("checksum vectors", () => {
    for (const s of bip173.checksum_valid) expect(bech32Decode(s)?.encoding, s).toBe("bech32");
    for (const s of bip350.checksum_valid) expect(bech32Decode(s)?.encoding, s).toBe("bech32m");
    for (const [s] of [...bip173.checksum_invalid, ...bip350.checksum_invalid] as [string, string][]) {
      const d = bech32Decode(s);
      // a string invalid as Bech32m may still be a valid Bech32 string and vice versa; neither list is valid in its own encoding
      expect(d === null || (bip173.checksum_invalid.some(([x]) => x === s) ? d.encoding !== "bech32" : d.encoding !== "bech32m"), s).toBe(
        true,
      );
    }
  });
  it("segwit address vectors (BIP-350 supersedes BIP-173 for versions 1-16)", () => {
    const hrpOf = (a: string) => a.slice(0, a.lastIndexOf("1")).toLowerCase();
    for (const [a, spk] of bip350.segwit_valid as [string, string][]) expect(decodeSegwitAddress(hrpOf(a), a)?.scriptPubKey, a).toBe(spk);
    for (const [a, spk] of bip173.segwit_valid as [string, string][]) {
      const d = decodeSegwitAddress(hrpOf(a), a);
      if (spk.startsWith("00")) expect(d?.scriptPubKey, a).toBe(spk);
      else expect(d, `${a} is v1+ with a Bech32 checksum, invalid under BIP-350`).toBeNull();
    }
    for (const [a] of [...bip173.segwit_invalid, ...bip350.segwit_invalid] as [string, string][]) {
      expect(decodeSegwitAddress("bc", a) ?? decodeSegwitAddress("tb", a), a).toBeNull();
    }
  });
});

describe("IP literals", () => {
  it("RFC 4291 section 2.2 text forms", () => {
    for (const v of [
      "ABCD:EF01:2345:6789:ABCD:EF01:2345:6789",
      "2001:DB8:0:0:8:800:200C:417A",
      "2001:DB8::8:800:200C:417A",
      "FF01::101",
      "::1",
      "::",
      "0:0:0:0:0:0:13.1.68.3",
      "::13.1.68.3",
      "::FFFF:129.144.52.38",
    ])
      expect(isIPv6(v), v).toBe(true);
    for (const v of ["1::2::3", "1:2:3:4:5:6:7:8:9", "12345::", "::1.2.3", "fe80::1%eth0", "1.2.3.4"]) expect(isIPv6(v), v).toBe(false);
    for (const v of ["0.0.0.0", "255.255.255.255", "192.0.2.1"]) expect(isIPv4(v), v).toBe(true);
    for (const v of ["256.1.1.1", "01.2.3.4", "1.2.3", "1.2.3.4.5", " 1.2.3.4"]) expect(isIPv4(v), v).toBe(false);
  });
  it("agrees with node:net on 20,000 generated candidates", () => {
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
    const pieces = ["", "0", "1", "ff", "FFFF", "12345", "g", "::", ":", ".", "255", "256", "01", "1.2.3.4", "a"];
    for (let i = 0; i < 20000; i++) {
      let s = "";
      const k = 1 + rnd(10);
      for (let j = 0; j < k; j++) s += pieces[rnd(pieces.length)] + (rnd(3) ? ":" : rnd(2) ? "." : "");
      expect([isIPv4(s) ? 4 : isIPv6(s) ? 6 : 0, s]).toEqual([nodeIsIP(s), s]);
    }
  });
});

describe("validate() dispatcher", () => {
  it("names the validator and separates valid, invalid and not checkable", () => {
    expect(validate("credit_card", "4111111111111111")).toEqual({ validator: "luhn", valid: true });
    expect(validate("visa_card", "5555555555554444")).toMatchObject({ valid: false, reason: "prefix" });
    expect(validate("mastercard", "2223003122003222")).toMatchObject({ valid: true });
    expect(validate("ethereum_address", "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed")).toMatchObject({
      valid: true,
      detail: "no-checksum",
    });
    expect(validate("bnb_address", "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD")).toMatchObject({ valid: false, reason: "checksum" });
    expect(validate("bitcoin_address", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")).toMatchObject({ valid: true, detail: "main:p2pkh" });
    expect(validate("bitcoin_address_p2sh", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")).toMatchObject({ valid: false });
    expect(validate("iban", "SA0380000000608010167519")).toMatchObject({ valid: true, detail: "SA" });
    expect(validate("ip_private", "172.16.0.1")).toMatchObject({ valid: true });
    expect(validate("ip_private", "172.32.0.1")).toMatchObject({ valid: false, reason: "not private" });
    expect(validate("domain", "example.co.uk")).toMatchObject({ valid: true });
    expect(validate("domain", "co.uk")).toMatchObject({ valid: false });
    expect(validate("email", "a@b.c")).toBeNull();
    expect(validatorFor("tron_address")).toBe("base58check");
  });
});
