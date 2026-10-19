import { it } from "vitest";

// P6-016 (owner directive 2026-10-18): the @slow mechanism for heavy guard
// tests. The default Vitest timeout stays 5 s for every test; tests that are
// explicitly known to be slow are tagged by calling slowIt() instead of it()
// and get 3x the default (15 s). Tagging is opt-in per test and must stay
// rare: a new test that exceeds 5 s without @slow is an intentional failure to
// be redesigned, not to be tagged (DECLARED_LIMITS, section 8).
export const SLOW_MS = 15_000;

/** A slow test: identical to it() but with the @slow timeout (SLOW_MS). */
export function slowIt(
  name: string,
  fn: () => void | Promise<void>,
  // The runner is injectable so the contract (timeout = SLOW_MS) is testable
  // deterministically without registering a real slow test (P6-016).
  runner: (name: string, fn: () => void | Promise<void>, timeout: number) => void = it,
): void {
  runner(name, fn, SLOW_MS);
}
