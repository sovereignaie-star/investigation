/**
 * P2-031 — the AIS dump importer: binds every vessel in an AIS-catcher JSON
 * dump to its entity and builds its time-track.
 *
 * AIS-catcher emits one JSON record per received message (NDJSON in its JSON
 * output modes); a recorded dump may also be a JSON array of records. Each
 * record carries the receiver's capture time as `rxtime` (YYYYMMDDHHMMSS,
 * UTC). The importer converts it to ISO-8601 UTC with strict calendar
 * validation (an impossible date such as month 13 is rejected — JavaScript's
 * Date would silently roll it over), then for every record with a valid MMSI
 * it ensures the `mmsi` entity exists (one node per vessel, D-019/D-020) and
 * runs TR-091 against that vessel as the run subject — so every position
 * claim (with its structured `observedAt` / `validFrom` / `validTo` window)
 * lands on the vessel entity and builds the time-track the acceptance
 * criteria require. A record the importer or TR-091 rejects is counted and
 * skipped, never silently dropped; only a typed TransformRunError is treated
 * as a rejected record — anything else (a ledger or storage failure) is a real
 * error and propagates.
 */
import { runTransform, TransformRunError } from "@ir/transforms";
import { aisVessel } from "@ir/transforms";
import { validate } from "@ir/core/validate";
import { ensureSubject, recordRunSuccess } from "./run-record.ts";
import type { Case } from "@ir/store";
import type { Clock } from "@ir/core";
import type { HttpTransport } from "@ir/engine/transport";

/** A local transform never issues a request; the transport exists only to satisfy the runner. */
const localTransport: HttpTransport = {
  async fetch() {
    throw new Error("TR-091 is a local transform and must never make a network request");
  },
};

export interface AisImportResult {
  /** Records in the dump (line-delimited records or array elements). */
  readonly vesselCount: number;
  /** The mmsi entity ids the import bound (one entry per valid record — the same vessel repeats). */
  readonly entityIds: string[];
  /** Claims the expansion created across every vessel. */
  readonly claimCount: number;
  /** Records rejected fail-closed (invalid mmsi/rxtime, or a TR-091 typed error). */
  readonly rejected: number;
}

/** rxtime is YYYYMMDDHHMMSS in UTC (AIS-catcher `Source/JSON/JSONAIS.cpp`). */
const RXTIME = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/;

/**
 * Converts an AIS-catcher `rxtime` to ISO-8601 UTC, rejecting impossible calendar
 * values: the components are validated per-field and round-tripped, so a month
 * 13 or a February 30 is refused instead of being rolled over by Date arithmetic.
 */
export function rxtimeToIso(rxtime: string): string | null {
  const m = RXTIME.exec(rxtime);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate(); // last day of month mo
  if (d > daysInMonth) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  const iso = new Date(ms).toISOString();
  return iso ===
    `${y.toString().padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(s).padStart(2, "0")}.000Z`
    ? iso
    : null;
}

/** Splits the dump into records: a JSON array, or newline-delimited JSON objects. */
function dumpRecords(content: string): unknown[] {
  const trimmed = content.trim();
  if (trimmed.startsWith("[")) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error("AIS import: a JSON array dump must be an array of records");
    return parsed;
  }
  const records: unknown[] = [];
  const lines = trimmed.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    try {
      records.push(JSON.parse(line));
    } catch (x) {
      throw new Error(
        `AIS import: line ${i + 1} is not valid JSON (a malformed dump is a file-level error, not a rejected record): ${(x as Error).message}`,
      );
    }
  }
  return records;
}

/** The usable identity of one record — its MMSI (validated) and capture time — or null when unusable. */
function vesselKey(rec: unknown): { mmsi: string; isoNow: string } | null {
  const r = rec as { mmsi?: unknown; rxtime?: unknown };
  const mmsi = typeof r?.mmsi === "number" ? String(Math.trunc(r.mmsi)) : typeof r?.mmsi === "string" ? r.mmsi.trim() : null;
  const rxtime = typeof r?.rxtime === "string" ? r.rxtime : null;
  const isoNow = rxtime === null ? null : rxtimeToIso(rxtime);
  if (mmsi === null || validate("mmsi", mmsi)?.valid !== true || isoNow === null) return null;
  return { mmsi, isoNow };
}

/** Reads one AIS-catcher JSON dump (NDJSON or a JSON array) and imports every vessel it carries. */
export async function importAisVesselDump(c: Case, content: string, clock: Clock): Promise<AisImportResult> {
  let parsed: unknown[];
  try {
    parsed = dumpRecords(content);
  } catch (x) {
    throw new Error(`AIS import: ${(x as Error).message}`);
  }

  let vesselCount = 0;
  let rejected = 0;
  let claimCount = 0;
  const entityIds: string[] = [];
  for (const rec of parsed) {
    vesselCount++;
    const key = vesselKey(rec);
    if (key === null) {
      rejected++; // an unusable MMSI (nine digits AND a MID in 201-775) or capture time is counted, never silently dropped
      continue;
    }
    const subjectId = ensureSubject(c, `mmsi:${key.mmsi}`, "mmsi", clock);
    entityIds.push(subjectId);
    const input = { vessel: rec as Record<string, unknown>, now: key.isoNow };
    try {
      const res = await runTransform(aisVessel as never, { transport: localTransport, input, signal: undefined });
      const recorded = recordRunSuccess(c, subjectId, aisVessel as never, input, res, clock);
      claimCount += recorded.expand.claimIds.length;
    } catch (x) {
      if (x instanceof TransformRunError) {
        rejected++; // a TR-091 typed error (bad mmsi/now/imo/scaled): counted, the vessel keeps its entity
        continue;
      }
      throw x; // a ledger or storage failure is a real error, never a rejected record
    }
  }
  return { vesselCount, entityIds, claimCount, rejected };
}
