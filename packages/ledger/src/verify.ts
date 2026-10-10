import { LedgerEntry } from "@ir/schema";
import { hashEntry, type Entry } from "./ledger.ts";

export type VerifyCode = "schema" | "seq" | "prev_hash" | "entry_hash" | "payload" | "length" | "head";

export interface VerifyError {
  /** Position in the array that was checked (-1 for whole-chain errors). */
  index: number;
  code: VerifyCode;
  message: string;
}

export interface VerifyReport {
  ok: boolean;
  length: number;
  head: string | null;
  /** First index that failed, or null. */
  firstBad: number | null;
  errors: VerifyError[];
}

export interface VerifyOptions {
  /** Known head hash (from a checkpoint or signature); detects truncation and replaced tails. */
  expectedHead?: string;
  /** Known minimum length; detects truncation when no head is known. */
  expectedLength?: number;
}

/**
 * Recomputes the chain (5.5). Reports every problem, not only the first: edited entries (entry_hash),
 * deleted, inserted or reordered entries (seq, prev_hash), and truncation against a known head or length.
 */
export function verify(entries: readonly unknown[], opts: VerifyOptions = {}): VerifyReport {
  const errors: VerifyError[] = [];
  const err = (index: number, code: VerifyCode, message: string) => errors.push({ index, code, message });
  let prev: Entry | null = null;
  entries.forEach((raw, i) => {
    const parsed = LedgerEntry.safeParse(raw);
    if (!parsed.success) {
      err(i, "schema", `entry ${i}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
      prev = null;
      return;
    }
    const e = parsed.data;
    if (e.seq !== i) err(i, "seq", `entry ${i}: seq is ${e.seq}, expected ${i} (deleted, inserted or reordered entry)`);
    const expectedPrev = i === 0 ? null : ((prev as Entry | null)?.entryHash ?? undefined);
    if (expectedPrev !== undefined && e.prevHash !== expectedPrev)
      err(i, "prev_hash", `entry ${i}: prevHash does not match entry ${i - 1}`);
    let h: string | null = null;
    try {
      h = hashEntry(e);
    } catch (x) {
      err(i, "payload", `entry ${i}: payload is not canonical JSON (${(x as Error).message})`);
    }
    if (h !== null && h !== e.entryHash) err(i, "entry_hash", `entry ${i}: content does not match entryHash (edited entry)`);
    prev = e;
  });
  const last = entries[entries.length - 1] as Partial<Entry> | undefined;
  const head = typeof last?.entryHash === "string" ? last.entryHash : null;
  if (opts.expectedLength !== undefined && entries.length < opts.expectedLength)
    err(-1, "length", `chain has ${entries.length} entries, expected at least ${opts.expectedLength} (truncated)`);
  if (opts.expectedHead !== undefined && !entries.some((e) => (e as Partial<Entry>).entryHash === opts.expectedHead))
    err(-1, "head", "expected head not found in chain (truncated or replaced)");
  const firstBad = errors.reduce<number | null>((m, x) => (x.index >= 0 && (m === null || x.index < m) ? x.index : m), null);
  return { ok: errors.length === 0, length: entries.length, head, firstBad, errors };
}
