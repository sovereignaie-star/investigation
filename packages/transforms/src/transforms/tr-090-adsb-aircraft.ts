/**
 * P2-031 — TR-090: ADS-B aircraft importer (readsb / dump1090).
 *
 * readsb and dump1090 publish an `aircraft.json` snapshot of the shape
 * `{ now: <epoch seconds>, aircraft: [...] }`; each record carries the ICAO
 * 24-bit transponder address (`hex`, six lowercase hex digits), an optional
 * trimmed callsign (`flight`), and the last observed position report
 * (`lat`, `lon`, `alt_baro`, `gs`, `track`). This transform is the per-record
 * parser: the importer reads the snapshot, converts `now` to ISO-8601 UTC, and
 * runs TR-090 once per aircraft with that aircraft's record bound to the
 * aircraft entity (the icao24 identifier) as the run subject — so every
 * position claim lands on the aircraft and builds its time-track.
 *
 * Local transform (LC-A): no network. `public` with an empty allow list is the
 * only valid declaration for a transform that never calls `ctx.http`. Fail
 * closed: a record without a usable `hex`, or a snapshot time that is not a
 * valid ISO-8601 UTC timestamp, is a typed error — never a silent empty
 * result. No raw text is used as an identifier (D-018): the callsign is the
 * typed `flight_callsign` catalog value, the position is a literal claim.
 *
 * The time fields (`observedAt`, `validFrom`, `validTo`) are the structured
 * P2-031 contract extension: a snapshot is a point observation, so the window
 * is the snapshot instant (`validFrom == validTo == now`).
 */
import { defineTransform } from "../manifest.ts";
import type { TransformContext } from "../transform.ts";

/** The shape of one readsb/dump1090 `aircraft` record (the fields TR-090 reads). */
export interface AdsbAircraftRecord {
  /** ICAO 24-bit transponder address — six lowercase hex digits. */
  readonly hex: string;
  /** Callsign / flight designator (already trimmed by the receiver). */
  readonly flight?: string;
  /** Last observed latitude, when present. */
  readonly lat?: number;
  /** Last observed longitude, when present. */
  readonly lon?: number;
  /** Barometric altitude in feet, or the literal "ground". */
  readonly alt_baro?: number | string;
  /** Ground speed in knots. */
  readonly gs?: number;
  /** True track in degrees. */
  readonly track?: number;
}

/** The TR-090 input: one aircraft record plus the receiver's snapshot time (ISO-8601 UTC). */
export interface AdsbAircraftInput {
  readonly aircraft: AdsbAircraftRecord;
  readonly now: string;
}

/** ISO-8601 UTC, the shape every time field in the output contract must carry. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/** A typed TR-090 error: fail-closed, never a silent empty result. */
export class Tr090Error extends Error {
  constructor(
    readonly code: "bad_hex" | "bad_now",
    message: string,
  ) {
    super(`TR-090: ${message}`);
    this.name = "Tr090Error";
  }
}

function isHex(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{6}$/.test(value);
}

/** Parses one number, rejecting NaN/Infinity — a report field must be a finite number. */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export const adsbAircraft = defineTransform<AdsbAircraftInput>(
  {
    id: "TR-090",
    version: "1.0.0",
    inputs: ["adsb_aircraft"],
    outputs: ["flight_callsign", "position", "altitude", "ground_speed", "true_track"],
    // Local transform: no network. `public` with an empty allow list is the
    // only valid declaration for a transform that never calls ctx.http.
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 100, timeoutMs: 10_000, maxBytes: 1_000_000 },
    sensitivity: "normal",
    license: "LC-A",
  },
  async (input: AdsbAircraftInput, _ctx: TransformContext) => {
    const rec = requireRecord(input);
    const now = requireNow(input);
    return { findings: buildFindings(rec, now) };
  },
);

/** Validates the aircraft record's shape; fail-closed on a missing or malformed address. */
function requireRecord(input: AdsbAircraftInput): AdsbAircraftRecord {
  if (!input || typeof input !== "object" || !input?.aircraft) {
    throw new Tr090Error("bad_hex", "input.aircraft is required");
  }
  if (!isHex(input.aircraft.hex)) {
    throw new Tr090Error("bad_hex", `aircraft.hex must be six lowercase hex digits (got ${JSON.stringify(input.aircraft.hex)})`);
  }
  return input.aircraft;
}

/** Validates the snapshot time; fail-closed when it is not a usable ISO-8601 UTC timestamp. */
function requireNow(input: AdsbAircraftInput): string {
  if (typeof input?.now !== "string" || !ISO_UTC.test(input.now) || Number.isNaN(Date.parse(input.now))) {
    throw new Tr090Error("bad_now", `now must be an ISO-8601 UTC timestamp (got ${JSON.stringify(input?.now)})`);
  }
  return input.now;
}

/** The shape of one time-carrying finding TR-090 emits. */
interface TimedFinding {
  predicate: string;
  objectType: string;
  objectValue: string;
  confidence: number;
  explanation: string;
  observedAt: string;
  validFrom?: string;
  validTo?: string;
}

/** Builds every finding one aircraft record yields, all carrying the snapshot time. */
function buildFindings(rec: AdsbAircraftRecord, now: string): TimedFinding[] {
  const findings: TimedFinding[] = [];

  // The callsign is a typed entity edge (flight_callsign identifier type).
  const flight = typeof rec.flight === "string" ? rec.flight.trim() : "";
  if (flight.length > 0) {
    findings.push({
      predicate: "has_callsign",
      objectType: "flight_callsign",
      objectValue: flight,
      confidence: 0.9,
      explanation: `ADS-B: aircraft ${rec.hex} reported the callsign ${flight}`,
      observedAt: now,
    });
  }

  // The position report: a literal claim with the full time window (a snapshot is a point).
  const lat = finiteNumber(rec.lat);
  const lon = finiteNumber(rec.lon);
  if (lat !== undefined && lon !== undefined) {
    const pos = `${lat},${lon}`;
    findings.push({
      predicate: "located_at",
      objectType: "position",
      objectValue: pos,
      confidence: 0.9,
      explanation: `ADS-B: aircraft ${rec.hex} was observed at ${pos}`,
      observedAt: now,
      validFrom: now,
      validTo: now,
    });
    const alt = typeof rec.alt_baro === "number" ? finiteNumber(rec.alt_baro) : rec.alt_baro === "ground" ? "ground" : undefined;
    if (alt !== undefined) {
      findings.push({
        predicate: "at_altitude",
        objectType: "altitude",
        objectValue: String(alt),
        confidence: 0.9,
        explanation: `ADS-B: aircraft ${rec.hex} reported barometric altitude ${alt}`,
        observedAt: now,
        validFrom: now,
        validTo: now,
      });
    }
  }
  const gs = finiteNumber(rec.gs);
  if (gs !== undefined) {
    findings.push({
      predicate: "ground_speed",
      objectType: "ground_speed",
      objectValue: String(gs),
      confidence: 0.9,
      explanation: `ADS-B: aircraft ${rec.hex} reported ground speed ${gs} knots`,
      observedAt: now,
    });
  }
  const track = finiteNumber(rec.track);
  if (track !== undefined) {
    findings.push({
      predicate: "true_track",
      objectType: "true_track",
      objectValue: String(track),
      confidence: 0.9,
      explanation: `ADS-B: aircraft ${rec.hex} reported true track ${track} degrees`,
      observedAt: now,
    });
  }

  return findings;
}
