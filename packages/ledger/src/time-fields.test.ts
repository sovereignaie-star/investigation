/**
 * P2-031 — TransformFinding time-field contract extension (red-first).
 *
 * The owner approved Option 1 (2026-10-18): three optional ISO-8601 UTC string
 * fields on TransformFinding — `observedAt` (capture time from the receiver),
 * `validFrom` / `validTo` (claim validity window) — and `expandFindings` uses
 * them when present, falling back to processing time when absent (the old
 * behavior, so existing transforms are unaffected). A `validTo` earlier than
 * its `validFrom`, or a value that is not a valid ISO-8601 UTC timestamp, is
 * rejected fail-closed: an error observation is recorded and no claim is made.
 */
import { manualClock, seededRandom, ulidFactory } from "@ir/core";
import { describe, expect, it } from "vitest";
import { Ledger } from "./index.ts";
import { expandFindings } from "./expansion.ts";

const T0 = "2026-10-10T08:00:00.000Z";

function fixture(seed = 1) {
  const clock = manualClock(T0);
  const id = ulidFactory(clock, seededRandom(seed));
  const ledger = new Ledger({ actor: "tester", clock });
  const add = (kind: Parameters<Ledger["append"]>[0], payload: unknown) => {
    clock.advance(1000);
    return ledger.append(kind, payload);
  };
  const entity = (type: string, value: string) => {
    const e = { id: id(), type, canonicalKey: `${type}:${value}`, labels: { en: value }, props: {} };
    add("entity.added", e);
    return e.id;
  };
  const evidence = () => {
    const sha = "ab".repeat(32);
    const ev = {
      id: id(),
      sha256: sha,
      mime: "application/json",
      size: 2,
      blobRef: `blobs/ab/${sha}`,
      fetchedAt: T0,
      request: { method: "LOCAL", url: "local://fixture", headers: {} },
      transformId: "tr-fixture",
      version: "1",
    };
    add("evidence.stored", ev);
    return ev.id;
  };
  return { ledger, add, id, entity, evidence, clock };
}

/** Reads the payload of every observation.added event the ledger recorded. */
function observationsOf(ledger: Ledger) {
  return ledger
    .entries()
    .filter((e) => e.kind === "observation.added")
    .map((e) => e.payload as { observedAt: string; kind: string; note?: string });
}

/** Reads the payload of every claim.added event the ledger recorded. */
function claimsOf(ledger: Ledger) {
  return ledger
    .entries()
    .filter((e) => e.kind === "claim.added")
    .map((e) => e.payload as { validFrom: string | null; validTo: string | null; predicate: string });
}

const finding = (extra: Record<string, unknown> = {}) => ({
  predicate: "located_at",
  objectType: "icao24",
  objectValue: "3c6444",
  confidence: 1,
  explanation: "ADS-B position report",
  ...extra,
});

describe("P2-031: TransformFinding time fields (contract extension)", () => {
  it("T-TF-001: without time fields the observation keeps the processing time (old behavior)", () => {
    const f = fixture();
    const subject = f.entity("icao24", "3c6444");
    const res = expandFindings({ findings: [finding()] }, subject, {
      ledger: f.ledger,
      transformId: "tr-090",
      evidenceId: f.evidence(),
      clock: f.clock,
    });
    expect(res.rejectedCount).toBe(0);
    const obs = observationsOf(f.ledger);
    expect(obs).toHaveLength(1);
    // The processing clock advances in the fixture; the observation must carry a time the clock produced (not a source time).
    expect(obs[0].observedAt > T0).toBe(true);
  });

  it("T-TF-002: an explicit observedAt is respected (capture time from the receiver)", () => {
    const f = fixture();
    const subject = f.entity("icao24", "3c6444");
    const capture = "2026-10-10T07:30:15.000Z";
    const res = expandFindings({ findings: [finding({ observedAt: capture })] }, subject, {
      ledger: f.ledger,
      transformId: "tr-090",
      evidenceId: f.evidence(),
      clock: f.clock,
    });
    expect(res.rejectedCount).toBe(0);
    const obs = observationsOf(f.ledger);
    expect(obs[0].observedAt).toBe(capture);
  });

  it("T-TF-003: validFrom/validTo are passed through to the claim", () => {
    const f = fixture();
    const subject = f.entity("icao24", "3c6444");
    const res = expandFindings({ findings: [finding({ observedAt: T0, validFrom: T0, validTo: "2026-10-10T08:00:10.000Z" })] }, subject, {
      ledger: f.ledger,
      transformId: "tr-090",
      evidenceId: f.evidence(),
      clock: f.clock,
    });
    expect(res.rejectedCount).toBe(0);
    const claims = claimsOf(f.ledger);
    expect(claims).toHaveLength(1);
    expect(claims[0].validFrom).toBe(T0);
    expect(claims[0].validTo).toBe("2026-10-10T08:00:10.000Z");
  });

  it("T-TF-004: validTo earlier than validFrom is rejected fail-closed (error observation, no claim)", () => {
    const f = fixture();
    const subject = f.entity("icao24", "3c6444");
    const res = expandFindings({ findings: [finding({ observedAt: T0, validFrom: "2026-10-10T08:00:10.000Z", validTo: T0 })] }, subject, {
      ledger: f.ledger,
      transformId: "tr-090",
      evidenceId: f.evidence(),
      clock: f.clock,
    });
    expect(res.claimIds).toHaveLength(0);
    expect(res.rejectedCount).toBe(1);
    const obs = observationsOf(f.ledger);
    expect(obs).toHaveLength(1);
    expect(obs[0].kind).toBe("error");
    expect(obs[0].note).toMatch(/validTo.*validFrom|validFrom.*validTo/);
  });

  it("T-TF-005: a non-ISO-8601 observedAt is rejected fail-closed", () => {
    const f = fixture();
    const subject = f.entity("icao24", "3c6444");
    const res = expandFindings({ findings: [finding({ observedAt: "not-a-timestamp" })] }, subject, {
      ledger: f.ledger,
      transformId: "tr-090",
      evidenceId: f.evidence(),
      clock: f.clock,
    });
    expect(res.claimIds).toHaveLength(0);
    expect(res.rejectedCount).toBe(1);
    const obs = observationsOf(f.ledger);
    expect(obs[0].kind).toBe("error");
  });

  it("T-TF-006: a non-ISO-8601 validFrom is rejected fail-closed", () => {
    const f = fixture();
    const subject = f.entity("icao24", "3c6444");
    const res = expandFindings({ findings: [finding({ validFrom: "2026-10-10 08:00" })] }, subject, {
      ledger: f.ledger,
      transformId: "tr-090",
      evidenceId: f.evidence(),
      clock: f.clock,
    });
    expect(res.claimIds).toHaveLength(0);
    expect(res.rejectedCount).toBe(1);
  });
});
