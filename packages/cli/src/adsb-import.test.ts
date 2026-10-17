/**
 * P2-031 — the ADS-B dump importer test (red-first).
 *
 * Proves the acceptance criteria end to end: a registered reference snapshot
 * is imported without loss (every aircraft becomes an entity), and every
 * aircraft carries its position claims with the structured time window —
 * the time-track. A record the transform rejects is counted, never dropped.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { manualClock } from "@ir/core";
import { openCase } from "@ir/store";
import { project } from "@ir/ledger/projections";
import { importAdsbAircraftDump } from "./adsb-import.ts";

const T0 = "2026-10-18T10:00:00.000Z";

const dirs: string[] = [];
afterEach(() => {
  for (let d = dirs.pop(); d !== undefined; d = dirs.pop()) rmSync(d, { recursive: true, force: true });
});

function newCase() {
  const dir = mkdtempSync(path.join(tmpdir(), "ir-p2031-"));
  dirs.push(dir);
  return openCase(dir, {
    actor: "test",
    create: { title: "P2-031", purpose: "مراجعة بنية تحتية مصرح بها", legalBasis: "security_incident" },
  });
}

/** A readsb/dump1090 snapshot: epoch-seconds `now` + two valid aircraft and one unusable record. */
const SNAPSHOT = JSON.stringify({
  now: 1792317600, // 2026-10-18T10:00:00Z
  aircraft: [
    { hex: "3c6444", flight: "UAL123", lat: 52.52, lon: 13.405, alt_baro: 35000, gs: 450.5, track: 270 },
    { hex: "a1b2c3", lat: 51.5, lon: 0.0, alt_baro: "ground" },
    { hex: "XXXXXX", lat: 1, lon: 2 }, // invalid address: counted as rejected
  ],
});

describe("P2-031: the ADS-B dump importer", () => {
  it("T-IMP-001: imports every valid aircraft as an entity and counts the rejected record", async () => {
    const c = newCase();
    const clock = manualClock(T0);
    const res = await importAdsbAircraftDump(c, SNAPSHOT, clock);
    expect(res.aircraftCount).toBe(3);
    expect(res.rejected).toBe(1);
    expect(res.entityIds).toHaveLength(2);
    const p = project(c.ledger.entries());
    // both aircraft entities exist, keyed by their icao24 canonical key
    const keys = p.graph.nodes.map((n) => n.canonicalKey).sort();
    expect(keys).toContain("icao24:3c6444");
    expect(keys).toContain("icao24:a1b2c3");
  });

  it("T-IMP-002: every aircraft carries its position claim with the structured time window (the time-track)", async () => {
    const c = newCase();
    const clock = manualClock(T0);
    await importAdsbAircraftDump(c, SNAPSHOT, clock);
    // the raw claims: the located_at claim on each aircraft carries the snapshot window
    const claims = c.ledger
      .entries()
      .filter((e) => e.kind === "claim.added")
      .map((e) => e.payload as { predicate: string; validFrom: string | null; validTo: string | null; value?: unknown });
    const located = claims.filter((x) => x.predicate === "located_at");
    expect(located).toHaveLength(2); // one per valid aircraft
    for (const claim of located) {
      expect(claim.validFrom).toBe(T0);
      expect(claim.validTo).toBe(T0);
    }
    // the observation bound to the claim carries the capture time, not the processing time
    const obs = c.ledger
      .entries()
      .filter((e) => e.kind === "observation.added")
      .map((e) => (e.payload as { observedAt: string }).observedAt);
    expect(new Set(obs)).toContain(T0);
  });

  it("T-IMP-003: an invalid dump (not JSON) is rejected fail-closed", async () => {
    const c = newCase();
    const clock = manualClock(T0);
    await expect(importAdsbAircraftDump(c, "not json", clock)).rejects.toThrow(/JSON/i);
  });

  it("T-IMP-004: a dump without `now`/`aircraft` is rejected fail-closed", async () => {
    const c = newCase();
    const clock = manualClock(T0);
    await expect(importAdsbAircraftDump(c, JSON.stringify({ hello: 1 }), clock)).rejects.toThrow(/now|aircraft/i);
  });
});
