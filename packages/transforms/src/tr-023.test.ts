/**
 * P2-011 — TR-023 contract tests (T-RULE-06). Companies House against a deterministic sim:
 * number → profile/officers/PSC, name → search, fail-closed on a missing key, auth errors and
 * invalid subjects, and D-018 (every emitted value satisfies its catalog type's pattern).
 * The gate (E-02) is enforced by the engine; the isolated tests prove the manifest-declared
 * env name reaches the sandboxed child (the production path) and that without it the run
 * fails closed before any transport call.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { companiesHouse } from "./transforms/tr-023-companies-house.ts";
import { runTransform } from "./runner.ts";

// A synthetic developer key for the sim (never a real secret; the same fail-closed rule as TR-028's
// public catalog token). The transform reads it from the environment at run time.
const KEY = "ch-key-2026";
process.env.IR_COMPANIES_HOUSE_TOKEN = KEY;
const AUTH = `Basic ${btoa(`${KEY}:`)}`;
const API = "https://api.company-information.service.gov.uk";

const PROFILE = JSON.stringify({
  company_name: "ACME LIMITED",
  company_number: "03194697",
  company_status: "active",
  type: "ltd",
  date_of_creation: "1992-03-10",
  registered_office_address: {
    address_line_1: "1 High Street",
    locality: "London",
    postal_code: "W1 1AA",
    country: "England",
  },
});
const OFFICERS = JSON.stringify({
  items: [
    { name: "John Smith", officer_role: "director", appointed_on: "2010-05-01" },
    { name: "Jane Doe", officer_role: "director", appointed_on: "2011-02-02", resigned_on: "2020-01-01" },
    { name: "Cher", officer_role: "director", appointed_on: "2012-01-01" }, // single word: not a person_name, skipped (D-018)
  ],
});
const PSC = JSON.stringify({
  items: [
    { name: "Robert Roe", natures_of_control: ["ownership-of-shares-25-to-50-percent"] },
    { name: "Gone Gone", natures_of_control: ["ownership-of-shares-75-percent-or-more"], ceased_on: "2019-01-01" },
  ],
});
const SEARCH = JSON.stringify({
  items: [
    { company_number: "03194697", company_name: "ACME LIMITED", company_status: "active" },
    { company_number: "SC123456", company_name: "ACME SCOTLAND LIMITED", company_status: "dissolved" },
  ],
});

const PROFILE_URL = `${API}/company/03194697`;
const OFFICERS_URL = `${API}/company/03194697/officers?items_per_page=50`;
const PSC_URL = `${API}/company/03194697/persons-with-significant-control?items_per_page=50`;
const SEARCH_URL = `${API}/search/companies?q=ACME%20LIMITED&items_per_page=10`;

function numberRoutes(): Array<{ match: RegExp | string; response: { status: number; body: string } }> {
  return [
    { match: PROFILE_URL, response: { status: 200, body: PROFILE } },
    { match: OFFICERS_URL, response: { status: 200, body: OFFICERS } },
    { match: PSC_URL, response: { status: 200, body: PSC } },
  ];
}

/** D-018: every emitted object value must satisfy its catalog type's own pattern. */
import { specById, matchesSpec } from "@ir/core/identifiers";

function expectCatalogValid(type: string, value: string): void {
  const spec = specById(type);
  if (!spec) throw new Error(`catalog type ${type} exists`);
  const m = matchesSpec(spec, value);
  expect(m.pattern, `${type} pattern accepts "${value}"`).toBe(true);
}

describe("TR-023 companies house", () => {
  it("a company number yields the registered name, office, active officers and active PSCs (3 requests)", async () => {
    const sim = createSimServer(numberRoutes());
    const result = await runTransform(companiesHouse, {
      transport: sim.transport,
      input: { company_number: "03194697" },
    });
    expect(result.requestCount).toBe(3);
    expect(sim.requests.map((r) => r.url)).toEqual([PROFILE_URL, OFFICERS_URL, PSC_URL]);
    // the key is in the Authorization header of every request, never in a URL
    for (const r of sim.requests) {
      expect(r.url).not.toContain(KEY);
      expect(r.headers?.Authorization).toBe(AUTH);
    }
    const findings = result.output.findings;
    expect(findings).toHaveLength(4);
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_registered_name", objectType: "company_name", objectValue: "ACME LIMITED" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        predicate: "has_registered_office",
        objectType: "street_address",
        objectValue: "1 High Street, London, W1 1AA, England",
      }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_officer", objectType: "person_name", objectValue: "John Smith" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_psc", objectType: "person_name", objectValue: "Robert Roe" }),
    );
    // resigned officer, ceased PSC and the single-word name are skipped
    const values = findings.map((f) => f.objectValue);
    expect(values).not.toContain("Jane Doe");
    expect(values).not.toContain("Gone Gone");
    expect(values).not.toContain("Cher");
    for (const f of findings) {
      expect(f.evidence).toHaveLength(1);
      expectCatalogValid(f.objectType, f.objectValue);
    }
  });

  it("a name search yields registration numbers for the matches (1 request)", async () => {
    const sim = createSimServer([{ match: SEARCH_URL, response: { status: 200, body: SEARCH } }]);
    const result = await runTransform(companiesHouse, { transport: sim.transport, input: { name: "ACME LIMITED" } });
    expect(result.requestCount).toBe(1);
    expect(sim.requests[0].url).toBe(SEARCH_URL);
    const findings = result.output.findings;
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({ predicate: "has_registration_number", objectType: "uk_company_number", objectValue: "03194697" });
    expect(findings[1]).toMatchObject({ objectType: "uk_company_number", objectValue: "SC123456" });
    for (const f of findings) expectCatalogValid(f.objectType, f.objectValue);
  });

  it("a 404 profile is a negative result: empty findings, no error", async () => {
    const sim = createSimServer([{ match: PROFILE_URL, response: { status: 404, body: "{}" } }]);
    const result = await runTransform(companiesHouse, { transport: sim.transport, input: { company_number: "03194697" } });
    expect(result.requestCount).toBe(1);
    expect(result.output.findings).toEqual([]);
  });

  it("a 401 rejects the run (an auth error is never an empty success)", async () => {
    const sim = createSimServer([{ match: PROFILE_URL, response: { status: 401, body: "{}" } }]);
    await expect(runTransform(companiesHouse, { transport: sim.transport, input: { company_number: "03194697" } })).rejects.toThrow(
      /rejected the key/,
    );
  });

  it("an invalid company number is refused before any request (fail-closed)", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(companiesHouse, { transport: sim.transport, input: { company_number: "12345" } })).rejects.toThrow(
      /invalid company number/,
    );
    expect(sim.requestCount()).toBe(0);
  });

  it("both or neither input field is refused before any request", async () => {
    const sim = createSimServer([]);
    await expect(
      runTransform(companiesHouse, { transport: sim.transport, input: { company_number: "03194697", name: "ACME LIMITED" } }),
    ).rejects.toThrow(/exactly one/);
    await expect(runTransform(companiesHouse, { transport: sim.transport, input: {} })).rejects.toThrow(/exactly one/);
    expect(sim.requestCount()).toBe(0);
  });

  it("a missing key fails closed before any transport call", async () => {
    const sim = createSimServer(numberRoutes());
    const original = process.env.IR_COMPANIES_HOUSE_TOKEN;
    delete process.env.IR_COMPANIES_HOUSE_TOKEN;
    try {
      await expect(runTransform(companiesHouse, { transport: sim.transport, input: { company_number: "03194697" } })).rejects.toThrow(
        /IR_COMPANIES_HOUSE_TOKEN is not set/,
      );
      expect(sim.requestCount()).toBe(0);
    } finally {
      process.env.IR_COMPANIES_HOUSE_TOKEN = original;
    }
  });
});

/**
 * The isolated path is the production path (`ir run --network` requires isolation), and the sandbox
 * does NOT inherit the parent's environment: without the manifest's `env` declaration the key could
 * never reach the child. These tests prove the declared name arrives over IPC (the Authorization
 * header the child builds), and that without it the run fails closed BEFORE any transport call.
 * Skipped where the sandbox cannot provide "full" isolation (same rule as T-ISO).
 */
import { fileURLToPath } from "node:url";
import { probeIsolation } from "@ir/transform-sandbox";

const MODULE = fileURLToPath(new URL("./transforms/tr-023-companies-house.ts", import.meta.url));
const isoHost = await probeIsolation();

describe.skipIf(!isoHost.full)("TR-023 isolated (production path: the sandbox does not inherit the parent env)", () => {
  it("the manifest-declared env name reaches the sandboxed child over IPC: the run succeeds and the key travels in the header", async () => {
    const sim = createSimServer(numberRoutes());
    const result = await runTransform(undefined, {
      transport: sim.transport,
      input: { company_number: "03194697" },
      requireIsolation: true,
      isolatedModule: MODULE,
      transformId: "TR-023",
    });
    expect(result.requestCount).toBe(3);
    expect(sim.requestCount()).toBe(3);
    for (const r of sim.requests) {
      expect(r.url).not.toContain(KEY);
      expect(r.headers?.Authorization).toBe(AUTH);
    }
    expect(result.output.findings).toHaveLength(4);
  });

  it("without the key the sandboxed run fails closed before any transport call", async () => {
    const sim = createSimServer(numberRoutes());
    const original = process.env.IR_COMPANIES_HOUSE_TOKEN;
    delete process.env.IR_COMPANIES_HOUSE_TOKEN;
    try {
      await expect(
        runTransform(undefined, {
          transport: sim.transport,
          input: { company_number: "03194697" },
          requireIsolation: true,
          isolatedModule: MODULE,
          transformId: "TR-023",
        }),
      ).rejects.toThrow(/IR_COMPANIES_HOUSE_TOKEN is not set/);
      expect(sim.requestCount()).toBe(0);
    } finally {
      process.env.IR_COMPANIES_HOUSE_TOKEN = original;
    }
  });
});
