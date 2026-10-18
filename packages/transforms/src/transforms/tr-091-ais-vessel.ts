/**
 * P2-031 — TR-091: AIS vessel importer (AIS-catcher).
 *
 * AIS-catcher delivers output in the form of NMEA messages and, in its JSON
 * output modes, one JSON record per received message. The record carries the
 * ship's MMSI (`mmsi`, nine digits — the first three are the MID), the position
 * report (`lat`, `lon`, `speed` in knots, `course`, `heading`) and, for the
 * static/voyage message (type 5), the vessel identity (`shipname`, `imo`).
 * Field names verified against the upstream source (`Source/JSON/KeyDefs.h`).
 * This transform is the per-record parser: the importer reads the dump,
 * converts the record's `rxtime` (YYYYMMDDHHMMSS, UTC) to ISO-8601 UTC, and
 * runs TR-091 once per vessel with that vessel's record bound to the vessel
 * entity (the mmsi identifier) as the run subject — so every position claim
 * lands on the vessel and builds its time-track.
 *
 * Local transform (LC-A): no network. `public` with an empty allow list is the
 * only valid declaration for a transform that never calls `ctx.http`. Fail
 * closed: a record without a usable `mmsi`, a capture time that is not a valid
 * ISO-8601 UTC timestamp, a present-but-invalid IMO check digit, or an
 * unscaled record (`scaled !== true`: raw encoder units are 0.1-knot / 0.1-degree
 * counts, not physical values) is a typed error — never a silent empty result.
 * ITU-R M.1371 "not available" values — SOG 102.2 knots, COG 360°, heading
 * 511° — are absent data: no claim is emitted for them, the rest of the record
 * still imports. No raw text is used as an identifier (D-018): the IMO number is
 * the typed `imo_ship_number` catalog value (validated by the #205 check-digit
 * validator via `@ir/core/validate`), the ship name is a literal attribute,
 * the position is a literal claim.
 *
 * The time fields (`observedAt`, `validFrom`, `validTo`) are the structured
 * P2-031 contract extension: a position report is a point observation, so the
 * window is the report instant (`validFrom == validTo == now`).
 */
import { defineTransform } from "../manifest.ts";
import type { TransformContext } from "../transform.ts";
import { validate } from "@ir/core/validate";

/** The shape of one AIS-catcher JSON record (the fields TR-091 reads). */
export interface AisVesselRecord {
  /** Ship-station MMSI — nine digits, the first three are the MID (ITU-R M.585). */
  readonly mmsi: string | number;
  /** IMO ship number from the type-5 static message; 0 = not available. */
  readonly imo?: string | number;
  /** Vessel name from the type-5 static message. */
  readonly shipname?: string;
  /** Last observed latitude, when present. */
  readonly lat?: number;
  /** Last observed longitude, when present. */
  readonly lon?: number;
  /** Speed over ground in knots (102.2 = not available, ITU-R M.1371). */
  readonly speed?: number;
  /** Course over ground in degrees (360 = not available, ITU-R M.1371). */
  readonly course?: number;
  /** True heading in degrees (511 = not available, ITU-R M.1371). */
  readonly heading?: number;
  /** AIS-catcher emits physical units when true; false/absent raw records are refused. */
  readonly scaled?: boolean;
}

/** The TR-091 input: one vessel record plus the receiver's capture time (ISO-8601 UTC). */
export interface AisVesselInput {
  readonly vessel: AisVesselRecord;
  readonly now: string;
}

/** ISO-8601 UTC, the shape every time field in the output contract must carry. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/** ITU-R M.1371 "not available" values: absent data, never a claim. */
const SOG_UNAVAILABLE = 102.2;
const COG_UNAVAILABLE = 360;
const HEADING_UNAVAILABLE = 511;

/** A typed TR-091 error: fail-closed, never a silent empty result. */
export class Tr091Error extends Error {
  constructor(
    readonly code: "bad_mmsi" | "bad_now" | "bad_imo" | "bad_scaled",
    message: string,
  ) {
    super(`TR-091: ${message}`);
    this.name = "Tr091Error";
  }
}

/** Normalizes an mmsi/imo value to its digit string; null when it is not digit-shaped. */
function digitString(value: string | number | undefined): string | null {
  if (value === undefined) return null;
  const s = typeof value === "number" ? String(Math.trunc(value)) : value.trim();
  return /^\d+$/.test(s) ? s : null;
}

/** Parses one number, rejecting NaN/Infinity — a report field must be a finite number. */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export const aisVessel = defineTransform<AisVesselInput>(
  {
    id: "TR-091",
    version: "1.0.0",
    inputs: ["ais_vessel"],
    outputs: ["imo_ship_number", "ship_name", "position", "speed_over_ground", "course_over_ground", "heading"],
    // Local transform: no network. `public` with an empty allow list is the
    // only valid declaration for a transform that never calls ctx.http.
    network: { mode: "public", allow: [] },
    secrets: [],
    limits: { rps: 100, timeoutMs: 10_000, maxBytes: 1_000_000 },
    sensitivity: "normal",
    license: "LC-A",
  },
  async (input: AisVesselInput, _ctx: TransformContext) => {
    const rec = requireRecord(input);
    const now = requireNow(input);
    return { findings: buildFindings(rec, now) };
  },
);

/** Validates the vessel record's shape; fail-closed on a missing or malformed MMSI. */
function requireRecord(input: AisVesselInput): AisVesselRecord {
  if (!input || typeof input !== "object" || !input?.vessel) {
    throw new Tr091Error("bad_mmsi", "input.vessel is required");
  }
  const mmsi = digitString(input.vessel.mmsi);
  if (mmsi === null || validate("mmsi", mmsi)?.valid !== true) {
    throw new Tr091Error(
      "bad_mmsi",
      `vessel.mmsi must be a nine-digit MMSI whose MID lies in 201-775 (got ${JSON.stringify(input.vessel.mmsi)})`,
    );
  }
  if (input.vessel.scaled !== true) {
    throw new Tr091Error(
      "bad_scaled",
      `vessel.scaled must be true: raw encoder units (0.1 knots / 0.1 degrees) are not physical values (got ${JSON.stringify(input.vessel.scaled)})`,
    );
  }
  const imo = digitString(input.vessel.imo);
  if (imo !== null && imo !== "0" && validate("imo_ship_number", imo)?.valid !== true) {
    throw new Tr091Error(
      "bad_imo",
      `vessel.imo must be a seven-digit IMO ship number with a valid check digit (got ${JSON.stringify(input.vessel.imo)})`,
    );
  }
  return input.vessel;
}

/** Validates the capture time; fail-closed when it is not a usable ISO-8601 UTC timestamp. */
function requireNow(input: AisVesselInput): string {
  if (typeof input?.now !== "string" || !ISO_UTC.test(input.now) || Number.isNaN(Date.parse(input.now))) {
    throw new Tr091Error("bad_now", `now must be an ISO-8601 UTC timestamp (got ${JSON.stringify(input?.now)})`);
  }
  return input.now;
}

/** The shape of one time-carrying finding TR-091 emits. */
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

/** Builds every finding one vessel record yields, all carrying the capture time. */
function buildFindings(rec: AisVesselRecord, now: string): TimedFinding[] {
  const findings: TimedFinding[] = [];
  const mmsi = digitString(rec.mmsi) as string;

  // The IMO number is a typed entity edge (imo_ship_number identifier type); 0 = not available.
  const imo = digitString(rec.imo);
  if (imo !== null && imo !== "0") {
    findings.push({
      predicate: "has_imo_number",
      objectType: "imo_ship_number",
      objectValue: imo,
      confidence: 0.9,
      explanation: `AIS: vessel ${mmsi} reported IMO ship number ${imo}`,
      observedAt: now,
    });
  }

  // The ship name is a literal attribute claim (not a catalog identifier type).
  const name = typeof rec.shipname === "string" ? rec.shipname.trim() : "";
  if (name.length > 0) {
    findings.push({
      predicate: "has_ship_name",
      objectType: "ship_name",
      objectValue: name,
      confidence: 0.9,
      explanation: `AIS: vessel ${mmsi} reported the name ${name}`,
      observedAt: now,
    });
  }

  pushPosition(rec, mmsi, now, findings);
  pushKinematics(rec, now, findings);
  return findings;
}

/** The position report: a literal claim with the full time window (a report is a point). */
function pushPosition(rec: AisVesselRecord, mmsi: string, now: string, findings: TimedFinding[]): void {
  const lat = finiteNumber(rec.lat);
  const lon = finiteNumber(rec.lon);
  if (lat === undefined || lon === undefined || lat < -90 || lat > 90 || lon < -180 || lon > 180) return;
  const pos = `${lat},${lon}`;
  findings.push({
    predicate: "located_at",
    objectType: "position",
    objectValue: pos,
    confidence: 0.9,
    explanation: `AIS: vessel ${mmsi} was observed at ${pos}`,
    observedAt: now,
    validFrom: now,
    validTo: now,
  });
}

/** The kinematic report — ITU-R M.1371 "not available" sentinels are absent data, never claims. */
function pushKinematics(rec: AisVesselRecord, now: string, findings: TimedFinding[]): void {
  const sog = finiteNumber(rec.speed);
  if (sog !== undefined && sog !== SOG_UNAVAILABLE) {
    findings.push({
      predicate: "speed_over_ground",
      objectType: "speed_over_ground",
      objectValue: String(sog),
      confidence: 0.9,
      explanation: `AIS: vessel ${digitString(rec.mmsi)} reported speed over ground ${sog} knots`,
      observedAt: now,
    });
  }
  const cog = finiteNumber(rec.course);
  if (cog !== undefined && cog !== COG_UNAVAILABLE) {
    findings.push({
      predicate: "course_over_ground",
      objectType: "course_over_ground",
      objectValue: String(cog),
      confidence: 0.9,
      explanation: `AIS: vessel ${digitString(rec.mmsi)} reported course over ground ${cog} degrees`,
      observedAt: now,
    });
  }
  const hdg = finiteNumber(rec.heading);
  if (hdg !== undefined && hdg !== HEADING_UNAVAILABLE) {
    findings.push({
      predicate: "heading",
      objectType: "heading",
      objectValue: String(hdg),
      confidence: 0.9,
      explanation: `AIS: vessel ${digitString(rec.mmsi)} reported true heading ${hdg} degrees`,
      observedAt: now,
    });
  }
}
