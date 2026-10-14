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

/**
 * P2-041 — a hard total request budget shared by every entry request of one investigation, enforced BEFORE
 * each hop's DNS (the first hop and every redirect hop inside `runHops`).
 *
 * The gateway takes one from the budget before resolving DNS for each hop; a hop that would pass the limit is
 * refused (and the request fails with `request_budget`), so no redirect can start after the budget is exhausted.
 * Unlike the outer `requestMeter` (which sees one gateway.request() call = one entry request, invisible to
 * redirect hops inside it), this counter lives INSIDE the gateway's hop loop, so `state.requests` reflects
 * every DNS+connect+bytes+rate-consuming transport call.
 *
 * JavaScript runs one callback at a time, so `take` is atomic: concurrent requests sharing one meter cannot
 * together overshoot the limit.
 */
export class RequestBudget {
  private used = 0;
  private overflowed = false;

  constructor(readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError(`request budget must be a non-negative integer (got ${limit})`);
  }

  /** Requests accepted so far (never more than `limit`). */
  get usedCount(): number {
    return this.used;
  }

  get remaining(): number {
    return this.limit - this.used;
  }

  /** True once nothing more can start: the limit is reached, or a hop was refused for going past it. */
  get exhausted(): boolean {
    return this.overflowed || this.used >= this.limit;
  }

  /** Accept one more request (one hop), or refuse it (and mark the budget exhausted) when it would pass the limit. */
  take(): boolean {
    if (this.used + 1 > this.limit) {
      this.overflowed = true;
      return false;
    }
    this.used += 1;
    return true;
  }
}

/** Duck-typed check (the gateway's request contract is validated at runtime). */
export function isRequestBudget(v: unknown): v is RequestBudget {
  return v instanceof RequestBudget;
}
