/**
 * P2-010 — TR-019 contract test (T-RULE-06). Runs the PGP keys transform against
 * a deterministic sim and asserts key findings.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { pgpKeys } from "./transforms/tr-019-pgp-keys.ts";
import { runTransform } from "./runner.ts";

describe("TR-019 pgp-keys", () => {
  it("emits a key finding for an email lookup", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/keys\.openpgp\.org\/vks\/v1\/by-email\//,
        response: { status: 200, body: "-----BEGIN PGP PUBLIC KEY BLOCK-----" },
      },
    ]);
    const result = await runTransform(pgpKeys, { transport: sim.transport, input: { email: "user@example.com" } });
    expect(result.requestCount).toBe(1);
    expect(result.output.findings[0]).toEqual(
      expect.objectContaining({ predicate: "has_pgp_key", objectType: "email", objectValue: "user@example.com" }),
    );
  });

  it("emits a key finding for a fingerprint lookup", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/keys\.openpgp\.org\/vks\/v1\/by-fingerprint\//,
        response: { status: 200, body: "-----BEGIN PGP PUBLIC KEY BLOCK-----" },
      },
    ]);
    const result = await runTransform(pgpKeys, {
      transport: sim.transport,
      input: { fingerprint: "0123 4567 89AB CDEF 0123 4567 89AB CDEF 0123 4567" },
    });
    expect(result.requestCount).toBe(1);
    expect(result.output.findings[0]).toEqual(expect.objectContaining({ predicate: "has_pgp_key", objectType: "pgp_fingerprint" }));
  });

  it("rejects an invalid email before any request (fail-closed)", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(pgpKeys, { transport: sim.transport, input: { email: "not-an-email" } })).rejects.toThrow(/invalid email/);
    expect(sim.requestCount()).toBe(0);
  });
});
