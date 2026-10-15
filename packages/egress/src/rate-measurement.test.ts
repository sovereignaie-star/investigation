/**
 * P2-003 condition 14 / ADR-08 item و — MEASUREMENT of the production path's rate limit under the
 * REAL clock. Skipped unless IR_RATE_MEASUREMENT=1, so CI and local runs stay deterministic; run it
 * on purpose:
 *
 *   IR_RATE_MEASUREMENT=1 pnpm exec vitest run packages/egress/src/rate-measurement.test.ts
 *
 * This is the measurement the ADR ties the operational value to (NOT a frozen-clock unit test): the
 * gateway is created exactly as the production path creates it — DEFAULT limits, real Date.now, no
 * injection — against a controlled host (a recording transport + a resolver that maps it to a public
 * address). What is measured:
 *
 *   1. how many requests actually LEAVE within the first second against one host (the effective
 *      burst the default allows — the datum the operational value is derived from: the strictest
 *      allowed source, Nominatim, publishes an ABSOLUTE 1 request/second, so the operational burst
 *      must be 1);
 *   2. that the limiter refuses further requests with an explicit rate_limit decision (fail-closed,
 *      never silently queued);
 *   3. that the bucket refills at the documented 1 request/second under the real clock (after a
 *      ~1.1s wait the next request is allowed again).
 *
 * The recorded timestamps and decisions are printed as a JSON report — that report is the evidence
 * recorded in docs/security/P2-003-ACCEPTANCE.md (condition 14).
 */
import { describe, expect, it } from "vitest";
import { createEgressGateway, type EgressAuditEvent, type EgressRequest, type EgressTransport } from "./egress.ts";

const MEASURE = process.env["IR_RATE_MEASUREMENT"] === "1";

/** The controlled "source": a public address (the address policy classifies it public), recorded. */
const HOST = "measure.example";
const IP = "93.184.216.34";
const REQ: EgressRequest = {
  caseId: "measure",
  purposeRef: "p2-003-condition-14",
  transform: "MEASURE@1.0.0",
  url: `https://${HOST}/file.json`,
  sends: ["ip", "asn"],
  sensitivity: "normal",
  // The same fixed-path exemption the production bootstrap uses (p2-039): the controlled host name
  // is a constant of the measurement, not case data, so it is not inventoried as an undeclared
  // domain. Everything else (query, headers) stays fully inspected.
  staticPaths: [`${HOST}/file.json`],
};

type FetchReq = Parameters<EgressTransport["fetch"]>[0];

function measuredGateway() {
  const starts: number[] = []; // transport start timestamps (ms, real clock)
  const transport: EgressTransport = {
    async fetch(_req: FetchReq) {
      starts.push(Date.now());
      return { status: 200, body: "{}" };
    },
  };
  const events: EgressAuditEvent[] = [];
  // No `limits`, no `now`: the DEFAULTS the production path (createProductionEgress) uses.
  const gw = createEgressGateway({
    resolver: { resolve: async () => [IP] },
    transport,
    allowedHosts: [HOST],
    auditSink: { record: (e) => void events.push(e) },
  });
  return { gw, starts, events };
}

describe.skipIf(!MEASURE)("MEASURE: the enforced per-host rate under the real clock (P2-003 / ADR-08 item و)", () => {
  it("records the effective first-second burst, the explicit refusals, and the 1/s refill", async () => {
    const { gw, starts, events } = measuredGateway();
    const decisions: Array<{ ok: boolean; reason?: string }> = [];
    const t0 = Date.now();

    // A burst of sequential requests against ONE host, as fast as the loop allows.
    for (let i = 0; i < 6; i++) {
      const r = await gw.request(REQ);
      decisions.push({ ok: r.ok, reason: r.ok ? undefined : r.reason });
    }

    const firstSecondLeaves = starts.filter((t) => t - t0 < 1000).length;
    const rateLimited = decisions.filter((d) => !d.ok && d.reason === "rate_limit").length;

    // The refill under the real clock: after ~1.1s the bucket holds one token again.
    await new Promise((r) => setTimeout(r, 1100));
    const afterWait = await gw.request(REQ);
    const refillAt = starts[starts.length - 1];

    // The report IS the measurement (recorded in P2-003-ACCEPTANCE.md, condition 14).
    const report = {
      measuredAt: new Date(t0).toISOString(),
      requests: 6,
      leaves: starts.length,
      leavesWithinFirstSecond: firstSecondLeaves,
      rateLimitedRefusals: rateLimited,
      sustainedSpacingMs: starts.length > 1 ? starts[1] - starts[0] : null,
      refill: { waitedMs: 1100, allowed: afterWait.ok, atMs: refillAt - t0 },
      audit: {
        allowed: events.filter((e) => e.kind === "allowed").length,
        rateLimited: events.filter((e) => e.kind === "rate_limited").length,
      },
    };
    console.log("RATE-MEASUREMENT " + JSON.stringify(report));

    // The operational decision this measurement locks (ADR-08 item و: the value follows the measured
    // distribution — the strictest allowed source's own policy): at most ONE leave per second per
    // host (burst 1), further requests refused explicitly, and the bucket refills at 1/s.
    expect(firstSecondLeaves).toBeLessThanOrEqual(1);
    expect(rateLimited).toBeGreaterThanOrEqual(1);
    expect(afterWait.ok).toBe(true);
  });
});
