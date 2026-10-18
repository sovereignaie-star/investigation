/**
 * P2-031 — TR-090 ADS-B aircraft importer contract test (red-first).
 *
 * readsb/dump1090 emit an `aircraft.json` snapshot: `{ now: <epoch seconds>, aircraft: [...] }`
 * where each record carries `hex` (ICAO 24-bit address), an optional trimmed `flight`
 * callsign, and the last observed `lat`/`lon`/`alt_baro`/`gs`/`track`. TR-090 is a
 * local LC-A transform: it takes ONE aircraft record plus the receiver's snapshot
 * time (ISO-8601 UTC) and emits that aircraft's findings — the callsign as an
 * entity edge, the position report as literal claims carrying the structured
 * time fields (`observedAt`, `validFrom`, `validTo`) the contract extension added.
 * Deterministic: literal fixtures, no network, fail-closed on bad input.
 */
import { describe, expect, it } from "vitest";
import { adsbAircraft } from "./tr-090-adsb-aircraft.ts";
import { runTransform } from "../runner.ts";
import type { HttpTransport } from "@ir/engine/transport";

const noopTransport: HttpTransport = {
  async fetch() {
    throw new Error("TR-090 must never make a network request");
  },
};

const NOW = "2026-10-18T10:00:00.000Z";

const aircraft = (over: Record<string, unknown> = {}) => ({
  hex: "3c6444",
  flight: "UAL123",
  lat: 52.52,
  lon: 13.405,
  alt_baro: 35000,
  gs: 450.5,
  track: 270.0,
  squawk: "1000",
  ...over,
});

async function run(input: unknown) {
  return runTransform(adsbAircraft as never, { transport: noopTransport, input, signal: undefined });
}

describe("P2-031: TR-090 ADS-B aircraft importer", () => {
  it("T-090-001: emits the callsign edge and the position report with the structured time fields", async () => {
    const res = await run({ aircraft: aircraft(), now: NOW });
    const f = res.output.findings;
    const byPredicate = new Map(f.map((x) => [x.predicate, x]));
    // The callsign is an entity edge (flight_callsign identifier type).
    expect(byPredicate.get("has_callsign")).toMatchObject({
      objectType: "flight_callsign",
      objectValue: "UAL123",
      observedAt: NOW,
    });
    // The position is a literal claim with the full time window.
    expect(byPredicate.get("located_at")).toMatchObject({
      objectType: "position",
      objectValue: "52.52,13.405",
      observedAt: NOW,
      validFrom: NOW,
      validTo: NOW,
    });
    // The rest of the report: altitude, ground speed, track — same window.
    expect(byPredicate.get("at_altitude")).toMatchObject({ objectValue: "35000", observedAt: NOW, validFrom: NOW, validTo: NOW });
    expect(byPredicate.get("ground_speed")).toMatchObject({ objectValue: "450.5", observedAt: NOW });
    expect(byPredicate.get("true_track")).toMatchObject({ objectValue: "270", observedAt: NOW });
  });

  it("T-090-002: an aircraft with no position emits the callsign but no located_at claim", async () => {
    const res = await run({ aircraft: aircraft({ lat: undefined, lon: undefined }), now: NOW });
    const preds = res.output.findings.map((f) => f.predicate);
    expect(preds).toContain("has_callsign");
    expect(preds).not.toContain("located_at");
    expect(preds).not.toContain("at_altitude");
  });

  it("T-090-003: an aircraft with no callsign emits no has_callsign edge", async () => {
    const res = await run({ aircraft: aircraft({ flight: undefined }), now: NOW });
    const preds = res.output.findings.map((f) => f.predicate);
    expect(preds).not.toContain("has_callsign");
    expect(preds).toContain("located_at");
  });

  it("T-090-004: an invalid hex is rejected fail-closed (no findings, a typed error)", async () => {
    await expect(run({ aircraft: aircraft({ hex: "NOTHEX" }), now: NOW })).rejects.toThrow(/hex/i);
  });

  it("T-090-005: an invalid snapshot time is rejected fail-closed", async () => {
    await expect(run({ aircraft: aircraft(), now: "not-a-time" })).rejects.toThrow(/now|ISO|time/i);
  });

  it("T-090-006: an empty aircraft record is rejected fail-closed", async () => {
    await expect(run({ aircraft: {}, now: NOW })).rejects.toThrow(/hex/i);
  });

  it("T-090-007: the manifest declares a local transform (public network, empty allow, no secrets)", () => {
    const m = adsbAircraft.manifest;
    expect(m.id).toBe("TR-090");
    expect(m.network).toMatchObject({ mode: "public", allow: [] });
    expect(m.secrets).toEqual([]);
    expect(m.license).toBe("LC-A");
  });
});
