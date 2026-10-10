import { base58CheckDecode } from "./base58.ts";
import { decodeSegwitAddress } from "./bech32.ts";

export type BitcoinNetwork = "main" | "test" | "regtest";
export type BitcoinAddress = { network: BitcoinNetwork; kind: "p2pkh" | "p2sh" | "segwit"; scriptPubKey: string };

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const BASE58: Record<number, { network: BitcoinNetwork; kind: "p2pkh" | "p2sh" }> = {
  0x00: { network: "main", kind: "p2pkh" },
  0x05: { network: "main", kind: "p2sh" },
  0x6f: { network: "test", kind: "p2pkh" },
  0xc4: { network: "test", kind: "p2sh" },
};
const HRP: Record<string, BitcoinNetwork> = { bc: "main", tb: "test", bcrt: "regtest" };

/**
 * Decodes a Bitcoin address (base58check P2PKH/P2SH or Bech32/Bech32m segwit) and returns its scriptPubKey, or null.
 * Testnet, testnet4 and signet share prefixes, so they are reported together as "test".
 */
export function decodeBitcoinAddress(addr: string): BitcoinAddress | null {
  const payload = base58CheckDecode(addr);
  if (payload) {
    const info = payload.length === 21 ? BASE58[payload[0] ?? -1] : undefined;
    if (!info) return null;
    const h = hex(payload.subarray(1));
    return { ...info, scriptPubKey: info.kind === "p2pkh" ? `76a914${h}88ac` : `a914${h}87` };
  }
  const sep = addr.lastIndexOf("1");
  const network = sep > 0 ? HRP[addr.slice(0, sep).toLowerCase()] : undefined;
  if (!network) return null;
  const sw = decodeSegwitAddress(addr.slice(0, sep).toLowerCase(), addr);
  return sw ? { network, kind: "segwit", scriptPubKey: sw.scriptPubKey } : null;
}
