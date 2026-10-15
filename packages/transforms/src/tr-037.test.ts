/**
 * P2-012 — TR-037 contract test (T-RULE-06). Local IBAN/BIC validation against the
 * SWIFT registry already shipped in @ir/core (P1-005). No network, no keys (LC-A):
 * the transport is a noop that throws if any request is attempted.
 *
 * Red first: this test was written before the transform existed and failed on the
 * missing module (the failing test for the right reason).
 */
import { describe, expect, it } from "vitest";
import { ibanBic } from "./transforms/tr-037-iban-bic.ts";
import { runTransform } from "./runner.ts";
import type { HttpTransport } from "@ir/engine/transport";

const noopTransport: HttpTransport = {
  async fetch() {
    throw new Error("TR-037 must never make a network request");
  },
};

/** Valid example IBAN (catalog positive example): Germany, mod-97 correct. */
const DE_IBAN = "DE89370400440532013000";

describe("TR-037 iban/bic", () => {
  it("a valid IBAN yields a finding with its country, derived from input alone", async () => {
    const result = await runTransform(ibanBic, { transport: noopTransport, input: { iban: DE_IBAN } });
    expect(result.requestCount).toBe(0);
    const findings = result.output.findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      predicate: "is_valid_iban",
      objectType: "iban",
      objectValue: DE_IBAN,
      confidence: 1,
    });
    expect(findings[0].explanation).toContain("DE");
    // Input-derived findings carry derivedFrom: "input", never evidence (P2-036).
    expect(findings[0].derivedFrom).toBe("input");
    expect(findings[0].evidence).toBeUndefined();
  });

  it("normalizes spacing and case before validating", async () => {
    const result = await runTransform(ibanBic, {
      transport: noopTransport,
      input: { iban: `  ${DE_IBAN.slice(0, 4)} ${DE_IBAN.slice(4)} `.toLowerCase() },
    });
    expect(result.output.findings[0].objectValue).toBe(DE_IBAN);
  });

  it("an invalid IBAN (checksum) is rejected fail-closed with the reason, no silent empty output", async () => {
    const bad = "DE89370400440532013001"; // valid structure, wrong check digits
    await expect(runTransform(ibanBic, { transport: noopTransport, input: { iban: bad } })).rejects.toThrow(/invalid IBAN.*checksum/);
  });

  it("an IBAN with a wrong length is rejected with the length reason", async () => {
    await expect(runTransform(ibanBic, { transport: noopTransport, input: { iban: "DE8937040044053201300" } })).rejects.toThrow(
      /invalid IBAN.*length/,
    );
  });

  it("a valid BIC yields a finding naming bank code and country, derived from input", async () => {
    const result = await runTransform(ibanBic, { transport: noopTransport, input: { bic: "deutdedb" } });
    expect(result.requestCount).toBe(0);
    const findings = result.output.findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      predicate: "is_valid_swift_bic",
      objectType: "swift_bic",
      objectValue: "DEUTDEDB",
      confidence: 1,
    });
    expect(findings[0].explanation).toContain("DEUT");
    expect(findings[0].explanation).toContain("DE");
    expect(findings[0].derivedFrom).toBe("input");
  });

  it("an invalid BIC is rejected fail-closed", async () => {
    await expect(runTransform(ibanBic, { transport: noopTransport, input: { bic: "DEUTDE" } })).rejects.toThrow(/invalid BIC/);
  });

  it("no input at all is rejected (an IBAN or a BIC is required)", async () => {
    await expect(runTransform(ibanBic, { transport: noopTransport, input: {} })).rejects.toThrow(/IBAN or BIC is required/);
  });
});
