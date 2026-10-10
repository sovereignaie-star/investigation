import { keccak256, toHex, utf8 } from "./hash.ts";

/** EIP-55 mixed-case checksum address for any EVM chain (Ethereum, BNB Smart Chain, Polygon, ...). */
export function toChecksumAddress(address: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("not a 20-byte hex address");
  const lower = address.slice(2).toLowerCase();
  const hash = toHex(keccak256(utf8(lower)));
  let out = "0x";
  for (let i = 0; i < 40; i++) {
    const ch = lower.charAt(i);
    out += parseInt(hash.charAt(i), 16) >= 8 ? ch.toUpperCase() : ch;
  }
  return out;
}

export type Eip55Result = { valid: boolean; checksummed: boolean; reason?: string };

/**
 * All-lowercase and all-uppercase addresses are valid but carry no checksum (EIP-55 "All caps" / "All Lower" cases);
 * a mixed-case address is valid only if its casing matches the checksum.
 */
export function checkEip55(address: string): Eip55Result {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return { valid: false, checksummed: false, reason: "format" };
  const body = address.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return { valid: true, checksummed: false };
  return toChecksumAddress(address) === address
    ? { valid: true, checksummed: true }
    : { valid: false, checksummed: true, reason: "checksum" };
}
