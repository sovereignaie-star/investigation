/**
 * P2-011 — TR-024 contract test (T-RULE-06). Runs the SEC EDGAR transform against
 * a deterministic sim and asserts filings metadata.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { secEdgar } from "./transforms/tr-024-sec-edgar.ts";
import { runTransform } from "./runner.ts";

const CIK = "320193";

describe("TR-024 sec edgar", () => {
  it("emits registered-name, ticker and filing findings for a valid CIK", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/data\.sec\.gov\/submissions\/CIK\d+\.json$/,
        response: {
          status: 200,
          body: JSON.stringify({
            name: "Apple Inc.",
            tickers: ["AAPL"],
            exchanges: ["Nasdaq"],
            filings: {
              recent: {
                form: ["10-K", "10-Q", "8-K", "4", "SC 13G"],
                filingDate: ["2026-09-30", "2026-07-31", "2026-05-01", "2026-04-15", "2026-02-10"],
                accessionNumber: [
                  "0000320193-26-000099",
                  "0000320193-26-000075",
                  "0000320193-26-000050",
                  "0000320193-26-000040",
                  "0000320193-26-000030",
                ],
              },
            },
          }),
        },
      },
    ]);
    const result = await runTransform(secEdgar, { transport: sim.transport, input: { cik: CIK } });
    expect(result.requestCount).toBe(1);
    const findings = result.output.findings;
    expect(findings.some((f) => f.predicate === "has_registered_name" && f.objectValue === CIK)).toBe(true);
    expect(findings.some((f) => f.predicate === "has_ticker" && f.objectValue === "AAPL")).toBe(true);
    expect(findings.filter((f) => f.predicate === "has_filing")).toHaveLength(5);
    for (const f of findings) expect(f.evidence).toEqual([result.output.findings[0].evidence?.[0]]);
  });

  it("rejects a non-numeric CIK before any request (fail-closed)", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(secEdgar, { transport: sim.transport, input: { cik: "ABC" } })).rejects.toThrow(/invalid CIK/);
    expect(sim.requestCount()).toBe(0);
  });

  it("a record with no name is an empty finding, not an error", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/data\.sec\.gov\/submissions\/CIK\d+\.json$/,
        response: { status: 200, body: JSON.stringify({ tickers: [] }) },
      },
    ]);
    const result = await runTransform(secEdgar, { transport: sim.transport, input: { cik: CIK } });
    expect(result.output.findings).toEqual([]);
  });
});
