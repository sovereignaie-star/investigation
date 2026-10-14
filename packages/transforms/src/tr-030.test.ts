/**
 * P2-011 — TR-030 contract test (T-RULE-06). Runs the Nominatim transform against
 * a deterministic sim and asserts geocode findings in both directions.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { nominatimGeocode } from "./transforms/tr-030-nominatim.ts";
import { runTransform } from "./runner.ts";

describe("TR-030 nominatim", () => {
  it("forward geocoding: an address yields a geo_point finding", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/nominatim\.openstreetmap\.org\/search\?/,
        response: {
          status: 200,
          body: JSON.stringify([
            { lat: "21.4225", lon: "39.8262", display_name: "Kaaba, Mecca, Saudi Arabia", type: "amenity", class: "place" },
          ]),
        },
      },
    ]);
    const result = await runTransform(nominatimGeocode, {
      transport: sim.transport,
      input: { address: "Kaaba, Mecca, Saudi Arabia" },
    });
    expect(result.requestCount).toBe(1);
    const f = result.output.findings[0];
    expect(f).toMatchObject({ predicate: "has_coordinates", objectType: "geo_point", objectValue: "21.4225,39.8262" });
    expect(f.explanation).toContain("Kaaba");
  });

  it("reverse geocoding: a point yields a street_address finding", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/nominatim\.openstreetmap\.org\/reverse\?/,
        response: {
          status: 200,
          body: JSON.stringify({ display_name: "1600 Amphitheatre Parkway, Mountain View, CA, USA" }),
        },
      },
    ]);
    const result = await runTransform(nominatimGeocode, { transport: sim.transport, input: { point: "37.4224,-122.0842" } });
    const f = result.output.findings[0];
    expect(f).toMatchObject({ predicate: "has_display_name", objectType: "street_address" });
    expect(f.objectValue).toContain("1600 Amphitheatre Parkway");
  });

  it("rejects a too-short address before any request (fail-closed)", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(nominatimGeocode, { transport: sim.transport, input: { address: "ab" } })).rejects.toThrow(/invalid address/);
    expect(sim.requestCount()).toBe(0);
  });

  it("no match (empty result) is an empty finding, not an error", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/nominatim\.openstreetmap\.org\/search\?/,
        response: { status: 200, body: "[]" },
      },
    ]);
    const result = await runTransform(nominatimGeocode, { transport: sim.transport, input: { address: "Nowhere Street, X" } });
    expect(result.output.findings).toEqual([]);
  });
});
