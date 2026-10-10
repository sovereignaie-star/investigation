import { cryptoRandom, systemClock, type Clock, type Random } from "./clock.ts";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32
const TIME_MAX = 2 ** 48 - 1;

function encodeTime(ms: number): string {
  if (!Number.isInteger(ms) || ms < 0 || ms > TIME_MAX) throw new RangeError(`ULID time out of range: ${ms}`);
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = ALPHABET[ms % 32] + out;
    ms = Math.floor(ms / 32);
  }
  return out;
}

/** 80 random bits as 16 base32 digits (each digit holds 5 bits). */
function encodeRandom(digits: number[]): string {
  return digits.map((d) => ALPHABET[d]).join("");
}

function randomDigits(random: Random): number[] {
  const bytes = random(new Uint8Array(10));
  const digits: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      digits.push((acc >>> bits) & 31);
    }
    acc &= (1 << bits) - 1;
  }
  return digits; // exactly 16
}

/**
 * Monotonic ULID factory (https://github.com/ulid/spec). Within the same millisecond (or if the clock steps back),
 * the random part is incremented so ids stay strictly increasing and sortable.
 */
export function ulidFactory(clock: Clock = systemClock, random: Random = cryptoRandom): () => string {
  let lastTime = -1;
  let last: number[] = [];
  return () => {
    const now = clock.now();
    if (now > lastTime) {
      lastTime = now;
      last = randomDigits(random);
    } else {
      const next = last.slice();
      let i = next.length - 1;
      while (i >= 0 && next[i] === 31) next[i--] = 0;
      if (i < 0) throw new RangeError("ULID random part overflow within one millisecond");
      next[i]++;
      last = next;
    }
    return encodeTime(lastTime) + encodeRandom(last);
  };
}

/** Milliseconds encoded in a ULID. */
export function ulidTime(id: string): number {
  if (!/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(id)) throw new TypeError(`not a ULID: ${id}`);
  let t = 0;
  for (const ch of id.slice(0, 10)) t = t * 32 + ALPHABET.indexOf(ch);
  return t;
}
