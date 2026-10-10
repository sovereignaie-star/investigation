/**
 * Injectable time and randomness (P1-019). Core code never calls Date.now(), new Date() or Math.random()
 * directly; it receives a Clock and a Random so that tests, replays (D1) and the simulation world (D11) are deterministic.
 */
export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
}

/** Fills the array with random bytes. */
export type Random = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;

export const systemClock: Clock = { now: () => Date.now() };

export const cryptoRandom: Random = (bytes) => globalThis.crypto.getRandomValues(bytes);

/** A clock frozen at `at` that moves only when told to. */
export function manualClock(at: number | string = 0): Clock & { set(t: number | string): void; advance(ms: number): void } {
  let t = typeof at === "string" ? Date.parse(at) : at;
  if (!Number.isFinite(t)) throw new RangeError(`invalid time: ${String(at)}`);
  return {
    now: () => t,
    set(v) {
      const n = typeof v === "string" ? Date.parse(v) : v;
      if (!Number.isFinite(n)) throw new RangeError(`invalid time: ${String(v)}`);
      t = n;
    },
    advance(ms) {
      if (!(ms >= 0)) throw new RangeError("time cannot go backwards");
      t += ms;
    },
  };
}

/** Deterministic PRNG (mulberry32) for tests and the simulation world. Not for secrets. */
export function seededRandom(seed: number): Random {
  let a = seed >>> 0;
  return (bytes) => {
    for (let i = 0; i < bytes.length; i++) {
      a = (a + 0x6d2b79f5) >>> 0;
      let x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      bytes[i] = ((x ^ (x >>> 14)) >>> 0) & 0xff;
    }
    return bytes;
  };
}

/** ISO-8601 UTC timestamp for the clock's current time. */
export function isoNow(clock: Clock): string {
  return new Date(clock.now()).toISOString();
}
