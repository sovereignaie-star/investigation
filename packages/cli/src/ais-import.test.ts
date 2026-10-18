/**
 * P2-031 — the AIS dump importer test (red-first).
 *
 * Proves the acceptance criteria end to end: a recorded reference file (the
 * AIS-catcher JSON output — one JSON record per line) is imported without loss
 * (every valid vessel becomes an entity; rejected records are counted, never
 * dropped), and every vessel carries its position claims with the structured
 * capture time — the time-track. The same MMSI across two capture instants is
 * ONE entity with two time points. The observation's observedAt is the
 * receiver's capture time (rxtime), never the processing time.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { manualClock } from "@ir/core";
import { openCase } from "@ir/store";
import { project } from "@ir/ledger/projections";
import { importAisVesselDump } from "./ais-import.ts";

const T0 = "2026-10-18T10:00:00.000Z";

const dirs: string[] = [];
afterEach(() => {
  for (let d = dirs.pop(); d !== undefined; d = dirs.pop()) rmSync(d, { recursive: true, force: true });
});

function newCase() {
  const dir = mkdtempSync(path.join(tmpdir(), "ir-p2031-ais-"));
  dirs.push(dir);
  return openCase(dir, {
    actor: "test",
    create: { title: "P2-031", purpose: "مراجعة بنية تحتية مصرح بها", legalBasis: "security_incident" },
  });
}

/** One type-1 position report (MID 246) and one unusable record. */
const POS_1000 = JSON.stringify({
  class: "AIS",
  device: "AIS-catcher",
  rxtime: "20261018100000",
  scaled: true,
  channel: "A",
  type: 1,
  mmsi: 246003000,
  lon: 4.263965,
  lat: 52.099342,
  speed: 12.3,
  course: 270,
  heading: 268,
});
const POS_1030 = JSON.stringify({
  class: "AIS",
  device: "AIS-catcher",
  rxtime: "20261018103000",
  scaled: true,
  channel: "A",
  type: 1,
  mmsi: 246003000,
  lon: 4.3,
  lat: 52.2,
  speed: 11,
  course: 271,
});
const BAD_MMSI = JSON.stringify({ rxtime: "20261018100000", scaled: true, mmsi: 123456789, lat: 1, lon: 2 });
const NO_RXTIME = JSON.stringify({ scaled: true, mmsi: 246003000, lat: 1, lon: 2 });

describe("P2-031: the AIS dump importer", () => {
  it("T-AIMP-001: imports every valid vessel as an entity and counts the rejected record", async () => {
    const c = newCase();
    const clock = manualClock(T0);
    const res = await importAisVesselDump(c, [POS_1000, BAD_MMSI].join("\n"), clock);
    expect(res.vesselCount).toBe(2);
    expect(res.rejected).toBe(1);
    expect(res.entityIds).toHaveLength(1);
    const p = project(c.ledger.entries());
    const keys = p.graph.nodes.map((n) => n.canonicalKey);
    expect(keys).toContain("mmsi:246003000");
  });

  it("T-AIMP-002: the same MMSI at two capture instants is one entity with a two-point time-track", async () => {
    const c = newCase();
    const clock = manualClock(T0);
    const res = await importAisVesselDump(c, [POS_1000, POS_1030].join("\n"), clock);
    expect(res.entityIds).toHaveLength(2); // two runs, both bound
    const entities = new Set(res.entityIds);
    expect(entities.size).toBe(1); // but ONE entity node (D-020: one node per canonical key)
    const claims = c.ledger
      .entries()
      .filter((e) => e.kind === "claim.added")
      .map((e) => e.payload as { predicate: string; validFrom: string | null; validTo: string | null });
    const located = claims.filter((x) => x.predicate === "located_at");
    expect(located).toHaveLength(2); // two time points on the vessel's track
    expect(located.map((x) => x.validFrom).sort()).toEqual(["2026-10-18T10:00:00.000Z", "2026-10-18T10:30:00.000Z"]);
    expect(located.map((x) => x.validTo).sort()).toEqual(["2026-10-18T10:00:00.000Z", "2026-10-18T10:30:00.000Z"]);
  });

  it("T-AIMP-003: the observations carry the capture time (rxtime), not the processing time", async () => {
    const c = newCase();
    const clock = manualClock(T0); // processing time 10:00; rxtime is 10:30 in POS_1030
    await importAisVesselDump(c, POS_1030, clock);
    const obs = c.ledger
      .entries()
      .filter((e) => e.kind === "observation.added")
      .map((e) => (e.payload as { observedAt: string }).observedAt);
    expect(new Set(obs)).toContain("2026-10-18T10:30:00.000Z");
  });

  it("T-AIMP-004: a record without a usable rxtime is rejected (counted), never silently dropped", async () => {
    const c = newCase();
    const clock = manualClock(T0);
    const res = await importAisVesselDump(c, [NO_RXTIME, BAD_MMSI].join("\n"), clock);
    expect(res.rejected).toBe(2);
    expect(res.entityIds).toHaveLength(0);
  });

  it("T-AIMP-005: an impossible rxtime (month 13) is rejected — no JavaScript date rollover", async () => {
    const c = newCase();
    const clock = manualClock(T0);
    const res = await importAisVesselDump(
      c,
      JSON.stringify({ scaled: true, mmsi: 246003000, lat: 1, lon: 2, rxtime: "20261301100000" }),
      clock,
    );
    expect(res.rejected).toBe(1);
    expect(res.entityIds).toHaveLength(0);
  });

  it("T-AIMP-006: a JSON array dump is accepted like the line-delimited stream", async () => {
    const c = newCase();
    const clock = manualClock(T0);
    const res = await importAisVesselDump(c, JSON.stringify([JSON.parse(POS_1000), JSON.parse(BAD_MMSI)]), clock);
    expect(res.vesselCount).toBe(2);
    expect(res.rejected).toBe(1);
    expect(res.entityIds).toHaveLength(1);
  });

  it("T-AIMP-007: a dump that is not JSON at all is rejected fail-closed", async () => {
    const c = newCase();
    const clock = manualClock(T0);
    await expect(importAisVesselDump(c, "not json", clock)).rejects.toThrow(/JSON|AIS/i);
  });

  it("T-AIMP-008: a malformed NDJSON line is a file-level error, not a rejected record", async () => {
    const c = newCase();
    const clock = manualClock(T0);
    await expect(importAisVesselDump(c, `${POS_1000}\n{broken`, clock)).rejects.toThrow(/line 2|JSON/i);
  });
});
