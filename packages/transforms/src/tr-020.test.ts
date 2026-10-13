/**
 * P2-010 — TR-020 contract test (T-RULE-06). Runs the email technical check
 * transform against a deterministic sim and asserts MX + disposable findings.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { emailTech } from "./transforms/tr-020-email-tech.ts";
import { runTransform } from "./runner.ts";

describe("TR-020 email-tech", () => {
  it("emits MX and disposable findings", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/dns\.google\/resolve\?name=mailinator\.com&type=MX$/,
        response: { status: 200, body: JSON.stringify({ Answer: [{ data: "10 mail.mailinator.com" }] }) },
      },
    ]);
    const result = await runTransform(emailTech, { transport: sim.transport, input: { email: "test@mailinator.com" } });
    expect(result.requestCount).toBe(1);
    const findings = result.output.findings;
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "is_disposable", objectType: "email_disposable", objectValue: "test@mailinator.com" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_mx_record", objectType: "mx_record", objectValue: "10 mail.mailinator.com" }),
    );
  });

  it("emits a no-MX finding when the domain has no MX record", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/dns\.google\/resolve\?name=example\.com&type=MX$/,
        response: { status: 200, body: JSON.stringify({ Answer: [] }) },
      },
    ]);
    const result = await runTransform(emailTech, { transport: sim.transport, input: { email: "user@example.com" } });
    expect(result.output.findings).toContainEqual(
      expect.objectContaining({ predicate: "has_no_mx_record", objectType: "domain", objectValue: "example.com" }),
    );
  });

  it("rejects an invalid email before any request (fail-closed)", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(emailTech, { transport: sim.transport, input: { email: "not-an-email" } })).rejects.toThrow(/invalid email/);
    expect(sim.requestCount()).toBe(0);
  });
});
