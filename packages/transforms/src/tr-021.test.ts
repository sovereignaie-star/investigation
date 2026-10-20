/**
 * P2-011 — TR-021 contract test (T-RULE-06). Runs the GLEIF transform against
 * a deterministic sim and asserts LEI findings.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { gleifEntity } from "./transforms/tr-021-gleif.ts";
import { runTransform } from "./runner.ts";

const LEI = "549300MLUDYVRQOOXS22";

describe("TR-021 gleif", () => {
  it("emits a legal-name finding for a valid LEI", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.gleif\.org\/api\/v1\/lei-records\//,
        response: {
          status: 200,
          body: JSON.stringify({
            data: { attributes: { lei: LEI, entity: { legalName: { name: "Example Corp" } } } },
          }),
        },
      },
    ]);
    const result = await runTransform(gleifEntity, { transport: sim.transport, input: { lei: LEI } });
    expect(result.requestCount).toBe(1);
    const findings = result.output.findings;
    expect(findings).toHaveLength(1);
    // P3-020/UC-04: the legal name is the finding's OBJECT — a company_name entity the ledger
    // links the LEI record to as an edge. The old shape (objectType lei_code, objectValue the
    // LEI itself) self-looped: the claim rendered nowhere (no edge, no attribute).
    expect(findings[0]).toMatchObject({
      predicate: "has_legal_name",
      objectType: "company_name",
      objectValue: "Example Corp",
    });
    expect(findings[0].explanation).toContain("Example Corp");
    expect(findings[0].evidence).toEqual([result.output.findings[0].evidence?.[0]]);
  });

  it("rejects an invalid LEI before any request (fail-closed)", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(gleifEntity, { transport: sim.transport, input: { lei: "not-an-lei" } })).rejects.toThrow(/invalid LEI/);
    expect(sim.requestCount()).toBe(0);
  });

  it("an empty record (no legalName) is an empty finding, not an error", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.gleif\.org\/api\/v1\/lei-records\//,
        response: { status: 200, body: JSON.stringify({ data: { attributes: { lei: LEI } } }) },
      },
    ]);
    const result = await runTransform(gleifEntity, { transport: sim.transport, input: { lei: LEI } });
    expect(result.output.findings).toEqual([]);
  });
});
