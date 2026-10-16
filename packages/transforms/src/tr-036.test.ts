/**
 * P2-012 — TR-036 contract test (T-RULE-06). Phone analysis, LOCAL ONLY
 * (libphonenumber-js `max` metadata — owner decision 2026-10-16: full flavor so
 * `getType` works; LC-A, catalog TL-97e7d609). The transform takes a phone
 * number in international E.164 form and derives country (ISO 3166-1 alpha-2),
 * number class and the canonical E.164 format — with ZERO network requests
 * (findings cite `derivedFrom: "input"`; a run that made no request must not
 * cite request evidence).
 *
 * Facts asserted below were measured from the library itself (max flavor) on
 * 2026-10-16 before the transform existed:
 *   +966501234567 => valid, SA, MOBILE
 *   +12025550123  => valid, US, FIXED_LINE_OR_MOBILE
 *   +80012345678  => valid, country UNDEFINED (universal freephone), TOLL_FREE
 *   +96612345678  => INVALID (a plausible-looking but unassigned SA number)
 *   +966501       => INVALID (too short)
 *   "call +966501234567" / ";123" / " ext. 123" => the library EXTRACTS the
 *   number (valid SA mobile) — the transform must reject them: the input
 *   contract is the E.164 form itself, not "text containing a number".
 *
 * The class finding's objectType is `line_type`, NOT `phone_type`: `phone_type`
 * collides with the `/^phone_/` normalize family in @ir/core (`normalize.ts`),
 * which would reject "mobile" as "not a phone number" — proven red-first below
 * before the rename.
 *
 * Red first: this test was written before the transform existed and failed on
 * the missing module (the failing test for the right reason).
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { canonicalKey } from "@ir/core";
import { phoneAnalysis } from "./transforms/tr-036-phone-analysis.ts";
import { runTransform } from "./runner.ts";

/** The sim server's transport shape — the counting wrapper keeps it. */
type SimTransport = ReturnType<typeof createSimServer>["transport"];

/** A transport that counts every fetch: the local analysis must issue none. */
function counting(t: SimTransport): { transport: SimTransport; calls: () => number } {
  let n = 0;
  return {
    calls: () => n,
    transport: {
      ...t,
      fetch: (...args: Parameters<SimTransport["fetch"]>) => {
        n++;
        return t.fetch(...args);
      },
    },
  };
}

describe("TR-036 phone analysis (local, no network)", () => {
  it("derives country, class and E.164 for a valid number — zero requests, findings cite the input", async () => {
    const sim = createSimServer([]);
    const counted = counting(sim.transport);
    const result = await runTransform(phoneAnalysis, { transport: counted.transport, input: { phone: "+966501234567" } });
    // Local analysis: not a single request may leave the transform.
    expect(result.requestCount).toBe(0);
    expect(counted.calls()).toBe(0);
    const findings = result.output.findings;
    expect(findings).toHaveLength(3);
    expect(findings).toContainEqual(
      expect.objectContaining({
        predicate: "has_country_code",
        objectType: "country_code",
        objectValue: "SA",
        derivedFrom: "input",
      }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        predicate: "has_phone_class",
        objectType: "line_type",
        objectValue: "mobile",
        derivedFrom: "input",
      }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        predicate: "formatted_e164",
        objectType: "phone_intl",
        objectValue: "+966501234567",
        derivedFrom: "input",
      }),
    );
    // No finding may cite request evidence: the run made no request.
    for (const f of findings) expect(f.evidence).toBeUndefined();
  });

  it("derives a compound class where the library cannot split fixed-line from mobile", async () => {
    const sim = createSimServer([]);
    const counted = counting(sim.transport);
    const result = await runTransform(phoneAnalysis, { transport: counted.transport, input: { phone: "+12025550123" } });
    expect(result.requestCount).toBe(0);
    expect(counted.calls()).toBe(0);
    expect(result.output.findings).toContainEqual(
      expect.objectContaining({
        predicate: "has_phone_class",
        objectType: "line_type",
        objectValue: "fixed_line_or_mobile",
        derivedFrom: "input",
      }),
    );
    expect(result.output.findings).toContainEqual(
      expect.objectContaining({ predicate: "has_country_code", objectType: "country_code", objectValue: "US" }),
    );
  });

  it("a valid number the metadata cannot pin to one country yields class + E.164, no country finding", async () => {
    // +800 is universal international freephone: the library returns country undefined.
    // Nothing is guessed: the country finding is simply absent, and the run succeeds
    // with the two facts that ARE determined (ROADMAP acceptance covers what the
    // metadata determines; a fabricated country would violate fail-closed).
    const sim = createSimServer([]);
    const result = await runTransform(phoneAnalysis, { transport: sim.transport, input: { phone: "+80012345678" } });
    expect(result.requestCount).toBe(0);
    const findings = result.output.findings;
    expect(findings).toHaveLength(2);
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_phone_class", objectType: "line_type", objectValue: "toll_free" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "formatted_e164", objectType: "phone_intl", objectValue: "+80012345678" }),
    );
    expect(findings.find((f) => f.predicate === "has_country_code")).toBeUndefined();
  });

  it("rejects invalid numbers before anything runs (fail-closed, zero transport calls)", async () => {
    const sim = createSimServer([]);
    const counted = counting(sim.transport);
    for (const bad of ["+966501", "+96612345678", "+abc", "0501234567", ""]) {
      await expect(runTransform(phoneAnalysis, { transport: counted.transport, input: { phone: bad } })).rejects.toThrow(
        /not a valid phone number|international E.164 form/,
      );
    }
    expect(counted.calls()).toBe(0);
  });

  it("rejects text that merely CONTAINS a number, and extension forms (input contract: E.164 only)", async () => {
    // The library itself would extract a valid SA mobile from all three — measured
    // 2026-10-16 — so the transform must enforce the form itself, fail-closed.
    const sim = createSimServer([]);
    const counted = counting(sim.transport);
    for (const bad of ["call +966501234567", "+966501234567;123", "+966501234567 ext. 123"]) {
      await expect(runTransform(phoneAnalysis, { transport: counted.transport, input: { phone: bad } })).rejects.toThrow(
        /international E.164 form/,
      );
    }
    expect(counted.calls()).toBe(0);
  });

  it("every emitted objectType is consumable through the catalog normalizer (canonicalKey)", async () => {
    // Red-first proof of the phone_type collision: canonicalKey("phone_type", "mobile")
    // threw "not a phone number" (the /^phone_/ normalize family) before the type was
    // renamed to line_type; country_code falls through to the text normalizer.
    expect(() => canonicalKey("country_code", "SA")).not.toThrow();
    expect(() => canonicalKey("line_type", "mobile")).not.toThrow();
    expect(() => canonicalKey("phone_intl", "+966501234567")).not.toThrow();
    // And the colliding name really is unusable for a class value:
    expect(() => canonicalKey("phone_type", "mobile")).toThrow(/not a phone number/);
  });
});
