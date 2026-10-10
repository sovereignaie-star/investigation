/** Bech32 (BIP-173) and Bech32m (BIP-350) decoding, following the reference implementation's checks. */

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
export const BECH32_CONST = 1;
export const BECH32M_CONST = 0x2bc830a3;
export type Encoding = "bech32" | "bech32m";

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = (((chk & 0x1ffffff) << 5) ^ v) >>> 0;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk = (chk ^ (GEN[i] ?? 0)) >>> 0;
  }
  return chk;
}

const hrpExpand = (hrp: string): number[] => [
  ...Array.from(hrp, (c) => c.charCodeAt(0) >> 5),
  0,
  ...Array.from(hrp, (c) => c.charCodeAt(0) & 31),
];

export type Bech32Decoded = { hrp: string; data: number[]; encoding: Encoding };

/** Returns null for any invalid string: bad characters, mixed case, length > 90, empty HRP, short or wrong checksum. */
export function bech32Decode(s: string): Bech32Decoded | null {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 33 || c > 126) return null;
  }
  if (s.toLowerCase() !== s && s.toUpperCase() !== s) return null;
  const str = s.toLowerCase();
  const pos = str.lastIndexOf("1");
  if (pos < 1 || pos + 7 > str.length || str.length > 90) return null;
  const hrp = str.slice(0, pos);
  const data: number[] = [];
  for (const c of str.slice(pos + 1)) {
    const v = CHARSET.indexOf(c);
    if (v < 0) return null;
    data.push(v);
  }
  const c = polymod([...hrpExpand(hrp), ...data]);
  const encoding: Encoding | null = c === BECH32_CONST ? "bech32" : c === BECH32M_CONST ? "bech32m" : null;
  if (!encoding) return null;
  return { hrp, data: data.slice(0, -6), encoding };
}

function convertBits(data: number[], from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const v of data) {
    if (v < 0 || v >> from) return null;
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits) out.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || (acc << (to - bits)) & maxv) {
    return null;
  }
  return out;
}

function segwitRulesHold(version: number, length: number, encoding: Encoding): boolean {
  if (version > 16 || length < 2 || length > 40) return false;
  if (version === 0) return encoding === "bech32" && (length === 20 || length === 32);
  return encoding === "bech32m";
}

export type SegwitDecoded = { version: number; program: Uint8Array; scriptPubKey: string };

/**
 * Segwit address decoding per BIP-350: version 0 must use Bech32, versions 1-16 must use Bech32m; program 2..40 bytes,
 * and exactly 20 or 32 bytes for version 0 (BIP-141).
 */
export function decodeSegwitAddress(hrp: string, addr: string): SegwitDecoded | null {
  const d = bech32Decode(addr);
  if (!d || d.hrp !== hrp || d.data.length < 1) return null;
  const version = d.data[0] ?? -1;
  const prog = convertBits(d.data.slice(1), 5, 8, false);
  if (!prog || !segwitRulesHold(version, prog.length, d.encoding)) return null;
  const program = Uint8Array.from(prog);
  const op = version === 0 ? 0 : 0x50 + version;
  const scriptPubKey =
    op.toString(16).padStart(2, "0") +
    prog.length.toString(16).padStart(2, "0") +
    Array.from(program, (b) => b.toString(16).padStart(2, "0")).join("");
  return { version, program, scriptPubKey };
}
