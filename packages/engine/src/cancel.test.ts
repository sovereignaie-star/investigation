import { describe, expect, it } from "vitest";
import { CancellationError, createCancellationToken } from "./cancel.ts";

describe("createCancellationToken", () => {
  it("starts uncancelled", () => {
    const ct = createCancellationToken();
    expect(ct.isCancelled).toBe(false);
    expect(ct.signal.aborted).toBe(false);
  });

  it("records the reason and resolves whenCancelled", async () => {
    const ct = createCancellationToken();
    const p = ct.whenCancelled;
    ct.cancel("budget");
    await expect(p).resolves.toBe("budget");
    expect(ct.isCancelled).toBe(true);
  });

  it("bridges to AbortSignal with CancellationError", () => {
    const ct = createCancellationToken();
    ct.cancel("owner");
    expect(ct.signal.aborted).toBe(true);
    expect(ct.signal.reason).toBeInstanceOf(CancellationError);
  });

  it("throwIfCancelled surfaces the reason", () => {
    const ct = createCancellationToken();
    ct.cancel("reviewer");
    expect(() => ct.throwIfCancelled()).toThrowError(CancellationError);
    expect(() => ct.throwIfCancelled()).toThrowError(/reviewer/);
  });

  it("cancelling twice keeps the first reason", async () => {
    const ct = createCancellationToken();
    ct.cancel("first");
    ct.cancel("second");
    await expect(ct.whenCancelled).resolves.toBe("first");
  });

  it("independent tokens do not interfere", () => {
    const a = createCancellationToken();
    const b = createCancellationToken();
    a.cancel("a");
    expect(b.isCancelled).toBe(false);
    expect(a.isCancelled).toBe(true);
  });
});
