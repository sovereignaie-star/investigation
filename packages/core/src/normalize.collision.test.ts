import { describe, expect, it } from "vitest";
import { canonicalKey, seededRandom } from "./index.ts";

/** P1-007 acceptance: no collision across 100,000 distinct identifiers, and every spelling variant maps back to its key. */
const N = 100_000;

function rng(seed: number) {
  const r = seededRandom(seed);
  const buf = new Uint8Array(4);
  return {
    int: (n: number) => {
      r(buf);
      return new DataView(buf.buffer).getUint32(0) % n;
    },
  };
}

describe("canonicalKey collision test (P1-007 acceptance)", () => {
  it(`${N.toLocaleString("en")} distinct identifiers give ${N.toLocaleString("en")} distinct keys; variants give the same key`, () => {
    const R = rng(20261010);
    const pick = (s: string) => s.charAt(R.int(s.length));
    const word = (len: number, alphabet = "abcdefghijklmnopqrstuvwxyz0123456789") =>
      Array.from({ length: len }, () => pick(alphabet)).join("");
    const hex = (len: number) => word(len, "0123456789abcdef");
    const gens: Array<[string, () => string, (v: string) => string]> = [
      ["domain", () => `${word(3 + R.int(10))}.${pick("ab")}${word(2)}.com`, (v) => ` ${v.toUpperCase()}. `],
      ["email", () => `${word(6)}.${word(4)}@${word(5)}.org`, (v) => v.toUpperCase()],
      [
        "ipv4",
        () => [0, 0, 0, 0].map(() => R.int(256)).join("."),
        (v) =>
          v
            .split(".")
            .map((o) => o.padStart(3, "0"))
            .join("."),
      ],
      // shared 70-char prefix: the legacy 64-char id would map all of these to one node
      [
        "url",
        () => `https://example.com/${"p".repeat(50)}/item-${word(10)}`,
        (v) => v.replace("https://example.com", "HTTPS://EXAMPLE.COM:443") + "#frag",
      ],
      [
        "phone_sa",
        () => `+9665${String(R.int(1e8)).padStart(8, "0")}`,
        (v) => v.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d))),
      ],
      ["ethereum_address", () => `0x${hex(40)}`, (v) => `0x${v.slice(2).toUpperCase()}`],
      ["sha256_hash", () => hex(64), (v) => v.toUpperCase()],
      ["twitter_username", () => `${word(8)}_${word(3)}`, (v) => `@${v.toUpperCase()}`],
      ["text", () => `محمد ${word(6, "ابتثجحخدذرزسشصضطظعغفقكلمنهوي")} ${word(4)}`, (v) => `  ${v.replace(/ /g, "   ")}\u200F`],
    ];
    // generators emit already-canonical spellings, so distinct inputs must give distinct keys
    const inputs = new Map<string, [string, string, (v: string) => string]>(); // "type\0raw" -> [type, raw, variant]
    let i = 0;
    while (inputs.size < N) {
      const g = gens[i++ % gens.length];
      if (!g) throw new Error("unreachable");
      const [type, gen, variant] = g;
      const raw = gen();
      inputs.set(`${type}\u0000${raw}`, [type, raw, variant]);
    }
    const keys = new Set<string>();
    for (const [type, raw, variant] of inputs.values()) {
      const key = canonicalKey(type, raw);
      keys.add(key);
      expect(canonicalKey(type, variant(raw))).toBe(key);
    }
    expect(inputs.size).toBe(N);
    expect(keys.size).toBe(N); // zero collisions
  });
});
