/**
 * Per-run cancellation (P2-001, D-022). Each run owns one CancellationToken; cancelling
 * one run must never affect any concurrent run. Unhandled rejections are avoided by
 * bridging to AbortSignal, and `run` surfaces a typed CancellationError.
 */
export class CancellationError extends Error {
  constructor(message = "run cancelled") {
    super(message);
    this.name = "CancellationError";
  }
}

export interface CancellationToken {
  readonly isCancelled: boolean;
  /** Resolves with the cancellation reason once cancelled. */
  readonly whenCancelled: Promise<string>;
  /** Bridge to AbortSignal so callers can reuse AbortController plumbing. */
  readonly signal: AbortSignal;
  cancel(reason?: string): void;
  /** Throws CancellationError if cancelled. */
  throwIfCancelled(): void;
}

export function createCancellationToken(): CancellationToken {
  let cancelled = false;
  let reason = "";
  let resolve: (r: string) => void = () => {};
  const whenCancelled = new Promise<string>((res) => (resolve = res));
  const controller = new AbortController();
  return {
    get isCancelled() {
      return cancelled;
    },
    whenCancelled,
    get signal() {
      return controller.signal;
    },
    cancel(r: string = "user") {
      if (cancelled) return;
      cancelled = true;
      reason = r;
      controller.abort(new CancellationError(r));
      resolve(r);
    },
    throwIfCancelled() {
      if (cancelled) throw new CancellationError(reason || "user");
    },
  };
}
