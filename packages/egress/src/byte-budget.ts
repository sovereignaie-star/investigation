/**
 * P2-039 — a hard total byte budget shared by every request of one investigation, enforced WHILE a response is
 * received (not between runs).
 *
 * The meter is charged chunk by chunk by the transport as bytes come off the wire, and the gateway charges whatever
 * a transport did not meter (a decoded body larger than its wire size, or a transport that returns a whole body).
 * A chunk that would take the total past the limit is NOT accepted: the transport destroys the stream and the
 * request fails with `byte_budget`, so no response larger than what is left is ever delivered, and once the budget
 * is exhausted no further request is started (the gateway refuses before DNS).
 *
 * JavaScript runs one callback at a time, so `take` is atomic: concurrent requests sharing one meter cannot
 * together overshoot the limit.
 */
export class ByteBudget {
  private usedBytes = 0;
  private overflowed = false;

  constructor(readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError(`byte budget must be a non-negative integer (got ${limit})`);
  }

  /** Bytes accepted so far (never more than `limit`). */
  get used(): number {
    return this.usedBytes;
  }

  get remaining(): number {
    return this.limit - this.usedBytes;
  }

  /** True once nothing more can be received: the limit is reached, or a chunk was refused for going past it. */
  get exhausted(): boolean {
    return this.overflowed || this.usedBytes >= this.limit;
  }

  /** Accept `n` more bytes, or refuse them (and mark the budget exhausted) when they would pass the limit. */
  take(n: number): boolean {
    if (!Number.isFinite(n) || n < 0) return false;
    if (n === 0) return true;
    if (this.usedBytes + n > this.limit) {
      this.overflowed = true;
      return false;
    }
    this.usedBytes += n;
    return true;
  }
}

/** Duck-typed check (the gateway's request contract is validated at runtime). */
export function isByteBudget(v: unknown): v is ByteBudget {
  return v instanceof ByteBudget;
}
