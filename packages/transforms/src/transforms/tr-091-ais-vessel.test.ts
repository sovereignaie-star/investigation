/**
 * P2-031 — TR-091 AIS vessel importer contract test (red-first).
 *
 * AIS-catcher delivers output in the form of NMEA messages and, in its JSON output
 * modes (`-o 3` / `JSON on` / `-o 5`), one JSON record per received message. The
 * record carries `mmsi`, the position report (`lat`, `lon`, `speed` in knots,
 * `course`, `heading`), and for the static/voyage message (type 5) the vessel
 * identity (`shipname`, `imo`). Field names verified against the upstream
 * source (AIS-catcher `Source/JSON/KeyDefs.h`). TR-091 is a local LC-A transform:
 * it takes ONE vessel record plus the receiver's capture time (ISO-8601 UTC) and
 * emits that vessel's findings — the IMO number as a typed entity edge
 * (imo_ship_number), the ship name as a literal attribute, the position report as
 * a literal claim carrying the structured time fields (`observedAt`,
 * `validFrom`, `validTo`). ITU-R M.1371 "unavailable" values (sog 102.2,
 * cog 360, heading 511) are absent data, never claims. Deterministic: literal
 * fixtures, no network, fail-closed on bad input.
 */
import { describe, expect, it } from "vitest";
import { aisVessel } from "./tr-091-ais-vessel.ts";
import { runTransform } from "../runner.ts";
import type { HttpTransport } from "@ir/engine/transport";

const noopTransport: HttpTransport = {
  async fetch() {
    throw new Error("TR-091 must never make a network request");
  },
};

const NOW = "2026-10-18T10:00:00.000Z";

/** A scaled AIS-catcher JSON record (MID 246 = Netherlands; IMO 9074729 has a valid check digit). */
const vessel = (over: Record<string, unknown> = {}) => ({
  mmsi: 246003000,
  shipname: "NORDLAND",
  lat: 52.099342,
  lon: 4.263965,
  speed: 12.3,
  course: 270.0,
  heading: 268,
  imo: 9074729,
  scaled: true,
  ...over,
});

async function run(input: unknown) {
  return runTransform(aisVessel as never, { transport: noopTransport, input, signal: undefined });
}

describe("P2-031: TR-091 AIS vessel importer", () => {
  it("T-091-001: emits the IMO edge, the ship-name attribute and the position report with the structured time fields", async () => {
    const res = await run({ vessel: vessel(), now: NOW });
    const f = res.output.findings;
    const byPredicate = new Map(f.map((x) => [x.predicate, x]));
    // The IMO number is a typed entity edge (imo_ship_number identifier type).
    expect(byPredicate.get("has_imo_number")).toMatchObject({
      objectType: "imo_ship_number",
      objectValue: "9074729",
      observedAt: NOW,
    });
    // The ship name is a literal attribute claim (not a catalog identifier type).
    expect(byPredicate.get("has_ship_name")).toMatchObject({
      objectType: "ship_name",
      objectValue: "NORDLAND",
      observedAt: NOW,
    });
    // The position is a literal claim with the full time window (a report is a point observation).
    expect(byPredicate.get("located_at")).toMatchObject({
      objectType: "position",
      objectValue: "52.099342,4.263965",
      observedAt: NOW,
      validFrom: NOW,
      validTo: NOW,
    });
    // The rest of the report: speed over ground, course over ground, heading.
    expect(byPredicate.get("speed_over_ground")).toMatchObject({ objectValue: "12.3", observedAt: NOW });
    expect(byPredicate.get("course_over_ground")).toMatchObject({ objectValue: "270", observedAt: NOW });
    expect(byPredicate.get("heading")).toMatchObject({ objectValue: "268", observedAt: NOW });
  });

  it("T-091-002: ITU-R M.1371 unavailable values (sog 102.2, cog 360, heading 511) emit no claims", async () => {
    const res = await run({
      vessel: vessel({ speed: 102.2, course: 360, heading: 511 }),
      now: NOW,
    });
    const preds = res.output.findings.map((f) => f.predicate);
    expect(preds).toContain("located_at"); // the position itself is present
    expect(preds).not.toContain("speed_over_ground");
    expect(preds).not.toContain("course_over_ground");
    expect(preds).not.toContain("heading");
  });

  it("T-091-003: a static-data record with no position emits the name but no located_at claim", async () => {
    const res = await run({
      vessel: vessel({ lat: undefined, lon: undefined, speed: undefined, course: undefined, heading: undefined }),
      now: NOW,
    });
    const preds = res.output.findings.map((f) => f.predicate);
    expect(preds).toContain("has_ship_name");
    expect(preds).not.toContain("located_at");
  });

  it("T-091-004: an invalid MMSI (MID outside 201-775) is rejected fail-closed", async () => {
    await expect(run({ vessel: vessel({ mmsi: 123456789 }), now: NOW })).rejects.toThrow(/mmsi/i);
  });

  it("T-091-005: an invalid capture time is rejected fail-closed", async () => {
    await expect(run({ vessel: vessel(), now: "not-a-time" })).rejects.toThrow(/now|ISO|time/i);
  });

  it("T-091-006: imo 0 (not available) is absent data, not an error and not an edge", async () => {
    const res = await run({ vessel: vessel({ imo: 0 }), now: NOW });
    const preds = res.output.findings.map((f) => f.predicate);
    expect(preds).not.toContain("has_imo_number");
    expect(preds).toContain("located_at"); // the rest of the record still imports
  });

  it("T-091-007: a present-but-invalid IMO check digit is rejected fail-closed", async () => {
    await expect(run({ vessel: vessel({ imo: 1234568 }), now: NOW })).rejects.toThrow(/imo/i);
  });

  it("T-091-008: an unscaled record (scaled !== true) is rejected fail-closed — raw encoder units are not physical values", async () => {
    await expect(run({ vessel: vessel({ scaled: false }), now: NOW })).rejects.toThrow(/scaled/i);
  });

  it("T-091-009: the manifest declares a local transform (public network, empty allow, no secrets)", () => {
    const m = aisVessel.manifest;
    expect(m.id).toBe("TR-091");
    expect(m.network).toMatchObject({ mode: "public", allow: [] });
    expect(m.secrets).toEqual([]);
    expect(m.license).toBe("LC-A");
  });
});
