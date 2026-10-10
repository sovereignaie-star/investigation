import { describe, expect, it } from "vitest";
import { isoNow, manualClock, seededRandom, ulidFactory, ulidTime } from "./index.ts";

describe("clock (P1-019)", () => {
  it("manual clock is frozen until advanced and refuses to go backwards", () => {
    const c = manualClock("2026-10-10T00:00:00.000Z");
    expect(isoNow(c)).toBe("2026-10-10T00:00:00.000Z");
    c.advance(1500);
    expect(isoNow(c)).toBe("2026-10-10T00:00:01.500Z");
    expect(() => c.advance(-1)).toThrow(RangeError);
    expect(() => manualClock("not a date")).toThrow(RangeError);
  });

  it("seeded random is reproducible and differs across seeds", () => {
    const a = seededRandom(42)(new Uint8Array(16));
    const b = seededRandom(42)(new Uint8Array(16));
    const c = seededRandom(43)(new Uint8Array(16));
    expect([...a]).toEqual([...b]);
    expect([...a]).not.toEqual([...c]);
  });
});

describe("ulid", () => {
  it("is deterministic with injected clock and random", () => {
    const mk = () => ulidFactory(manualClock(1_700_000_000_000), seededRandom(7));
    const a = mk();
    const b = mk();
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("encodes time, matches the spec alphabet and sorts monotonically within one millisecond", () => {
    const clock = manualClock(1_700_000_000_000);
    const next = ulidFactory(clock, seededRandom(1));
    const ids = Array.from({ length: 1000 }, () => next());
    for (const id of ids) {
      expect(id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
      expect(ulidTime(id)).toBe(1_700_000_000_000);
    }
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    clock.advance(1);
    const later = next();
    expect(later > (ids.at(-1) ?? "")).toBe(true);
    expect(ulidTime(later)).toBe(1_700_000_000_001);
  });

  it("encodes the known spec time prefix", () => {
    // ulid spec example: time 1469918176385 -> "01ARYZ6S41"
    expect(ulidFactory(manualClock(1469918176385), seededRandom(0))().slice(0, 10)).toBe("01ARYZ6S41");
  });

  it("stays monotonic when the clock steps back", () => {
    const clock = manualClock(10_000);
    const next = ulidFactory(clock, seededRandom(3));
    const a = next();
    clock.set(5_000);
    const b = next();
    expect(b > a).toBe(true);
    expect(ulidTime(b)).toBe(10_000);
  });
});
