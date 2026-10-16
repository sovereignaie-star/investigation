/**
 * TR-051 contract test (T-RULE-06). Runs the Hunter domain-search transform against a
 * deterministic sim and asserts exact findings. The manifest declares a secret (pinned mode);
 * the sim stands in for the egress gateway that would inject the X-API-KEY header — no real key
 * or connection is used. The transform's sensitivity is natural_person_gate (E-02: public emails
 * identify people); the subject is a domain (catalog sensitivity normal).
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import type { TransportRequest } from "@ir/engine/transport";
import { hunterDomainEmails } from "./transforms/tr-051-hunter-emails.ts";
import { runTransform } from "./runner.ts";

function hunterResponse(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    data: {
      domain: "example.com",
      disposable: false,
      webmail: false,
      accept_all: false,
      pattern: "{first}",
      organization: "Example",
      linked_domains: [],
      emails: [
        {
          value: "john@example.com",
          type: "personal",
          confidence: 92,
          first_name: "John",
          last_name: "Doe",
          position: "Support Engineer",
          sources: [],
        },
        {
          value: "contact@example.com",
          type: "generic",
          confidence: 98,
          first_name: null,
          last_name: null,
          position: null,
          sources: [],
        },
      ],
      ...overrides,
    },
    meta: { results: 2, results_approximate: false, limit: 10, offset: 0 },
  });
}

describe("TR-051 hunter-domain-emails", () => {
  it("emits a finding per published email with the source's own confidence, and the domain's email pattern", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.hunter\.io\/v2\/domain-search\?domain=example\.com$/,
        response: { status: 200, body: hunterResponse() },
      },
    ]);
    const result = await runTransform(hunterDomainEmails, { transport: sim.transport, input: { domain: "example.com" } });
    expect(result.requestCount).toBe(1);
    const findings = result.output.findings;
    expect(findings).toContainEqual(
      expect.objectContaining({
        predicate: "has_public_email",
        objectType: "email",
        objectValue: "john@example.com",
        confidence: 0.92,
      }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_public_email", objectType: "email", objectValue: "contact@example.com" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        predicate: "has_email_pattern",
        objectType: "domain",
        objectValue: "example.com",
      }),
    );
    expect(findings.find((f) => f.predicate === "has_email_pattern")?.explanation).toContain("{first}");
  });

  it("sends ONLY the domain query parameter (no limit, no offset, no type)", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.hunter\.io\/v2\/domain-search\?domain=example\.com$/,
        response: { status: 200, body: hunterResponse() },
      },
    ]);
    const urls: string[] = [];
    const wrapped = {
      fetch: async (req: TransportRequest, signal: AbortSignal) => {
        urls.push(req.url);
        return sim.transport.fetch(req, signal);
      },
    };
    await runTransform(hunterDomainEmails, { transport: wrapped, input: { domain: "example.com" } });
    expect(urls).toEqual(["https://api.hunter.io/v2/domain-search?domain=example.com"]);
  });

  it("a malformed response (no data object) fails as a source error, not an empty success", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.hunter\.io\/v2\/domain-search\?domain=example\.com$/,
        response: { status: 200, body: JSON.stringify({}) },
      },
    ]);
    await expect(runTransform(hunterDomainEmails, { transport: sim.transport, input: { domain: "example.com" } })).rejects.toThrow(
      /Hunter/,
    );
  });

  it("a response about a DIFFERENT domain is refused fail-closed — its records are never attributed to the requested subject", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.hunter\.io\/v2\/domain-search\?domain=example\.com$/,
        response: { status: 200, body: hunterResponse({ domain: "other.com" }) },
      },
    ]);
    await expect(runTransform(hunterDomainEmails, { transport: sim.transport, input: { domain: "example.com" } })).rejects.toThrow(
      /different domain/i,
    );
  });

  it("a domain the source knows nothing about is a real negative: empty findings, no error (no_result state)", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.hunter\.io\/v2\/domain-search\?domain=nowhere\.example$/,
        response: { status: 200, body: hunterResponse({ domain: null, pattern: null, organization: null, emails: [] }) },
      },
    ]);
    const result = await runTransform(hunterDomainEmails, { transport: sim.transport, input: { domain: "nowhere.example" } });
    expect(result.output.findings).toHaveLength(0);
  });

  it("an invalid email value in the response is skipped, not emitted as a finding", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.hunter\.io\/v2\/domain-search\?domain=example\.com$/,
        response: { status: 200, body: hunterResponse({ emails: [{ value: "not an email", confidence: 90 }] }) },
      },
    ]);
    const result = await runTransform(hunterDomainEmails, { transport: sim.transport, input: { domain: "example.com" } });
    expect(result.output.findings.find((f) => f.predicate === "has_public_email")).toBeUndefined();
  });

  it("fails closed on a non-200 status", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.hunter\.io\/v2\/domain-search\?domain=example\.com$/,
        response: { status: 429, body: "" },
      },
    ]);
    await expect(runTransform(hunterDomainEmails, { transport: sim.transport, input: { domain: "example.com" } })).rejects.toThrow(
      /Hunter/,
    );
  });

  it("rejects a non-domain input before any request", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(hunterDomainEmails, { transport: sim.transport, input: { domain: "not a domain" } })).rejects.toThrow(
      /domain/,
    );
    expect(sim.requestCount()).toBe(0);
  });

  it("rejects a missing input field before any request", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(hunterDomainEmails, { transport: sim.transport, input: {} })).rejects.toThrow(/domain is required/);
    expect(sim.requestCount()).toBe(0);
  });
});
