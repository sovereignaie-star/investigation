/**
 * P2-031 — the ADS-B dump importer: binds every aircraft in a readsb/dump1090
 * `aircraft.json` snapshot to its entity and builds its time-track.
 *
 * The snapshot is `{ now: <epoch seconds>, aircraft: [...] }`. The importer
 * converts `now` to ISO-8601 UTC, then for every record with a valid ICAO
 * 24-bit address it ensures the `icao24` entity exists (one node per
 * aircraft, D-019/D-020) and runs TR-090 against that aircraft as the run
 * subject — so every position claim (with its structured `observedAt` /
 * `validFrom` / `validTo` window) lands on the aircraft entity and builds
 * the time-track the acceptance criteria require. A record that TR-090
 * rejects is counted and skipped, never silently dropped.
 */
import { runTransform } from "@ir/transforms";
import { adsbAircraft } from "@ir/transforms";
import { ensureSubject, recordRunSuccess } from "./run-record.ts";
import type { Case } from "@ir/store";
import type { Clock } from "@ir/core";
import type { HttpTransport } from "@ir/engine/transport";

/** A local transform never issues a request; the transport exists only to satisfy the runner. */
const localTransport: HttpTransport = {
  async fetch() {
    throw new Error("TR-090 is a local transform and must never make a network request");
  },
};

export interface AdsbImportResult {
  /** Records in the snapshot's `aircraft` array. */
  readonly aircraftCount: number;
  /** The icao24 entity ids the import bound (one per valid aircraft). */
  readonly entityIds: string[];
  /** Claims the expansion created across every aircraft. */
  readonly claimCount: number;
  /** Records rejected fail-closed (invalid hex, or a TR-090 typed error). */
  readonly rejected: number;
}

/** Reads one readsb/dump1090 `aircraft.json` snapshot and imports every aircraft it carries. */
export async function importAdsbAircraftDump(c: Case, content: string, clock: Clock): Promise<AdsbImportResult> {
  let parsed: { now?: unknown; aircraft?: unknown };
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("ADS-B import: the dump is not valid JSON (expected a readsb/dump1090 aircraft.json)");
  }
  if (typeof parsed.now !== "number" || !Number.isFinite(parsed.now) || !Array.isArray(parsed.aircraft)) {
    throw new Error(
      "ADS-B import: the dump must carry a numeric `now` (epoch seconds) and an `aircraft` array (readsb/dump1090 aircraft.json)",
    );
  }
  const isoNow = new Date(parsed.now * 1000).toISOString();

  let aircraftCount = 0;
  let rejected = 0;
  let claimCount = 0;
  const entityIds: string[] = [];
  for (const rec of parsed.aircraft) {
    aircraftCount++;
    if (typeof rec?.hex !== "string" || !/^[0-9a-f]{6}$/.test(rec.hex)) {
      rejected++; // an unusable address is counted, never silently dropped
      continue;
    }
    const subjectId = ensureSubject(c, `icao24:${rec.hex}`, "icao24", clock);
    entityIds.push(subjectId);
    const input = { aircraft: rec as Record<string, unknown>, now: isoNow };
    try {
      const res = await runTransform(adsbAircraft as never, { transport: localTransport, input, signal: undefined });
      const recorded = recordRunSuccess(c, subjectId, adsbAircraft as never, input, res, clock);
      claimCount += recorded.expand.claimIds.length;
    } catch {
      rejected++; // a TR-090 typed error (bad hex/now shape): counted, the aircraft keeps its entity
    }
  }
  return { aircraftCount, entityIds, claimCount, rejected };
}
