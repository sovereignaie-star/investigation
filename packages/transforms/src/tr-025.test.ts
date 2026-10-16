import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { opensanctions } from "./transforms/tr-025-opensanctions.ts";
import { runTransform } from "./runner.ts";

// A synthetic OpenSanctions API key for the sim (never a real secret; the same fail-closed rule
// as TR-023/TR-040). The transform reads it from the environment at run time.
const API_KEY = "os-key-2026";
process.env.IR_OPENSANCTIONS_TOKEN = API_KEY;
const API = "https://api.opensanctions.org";

// The screening subject — a person name (case data under ADR-28: it travels ONLY in the
// fixed-schema POST body, never in a URL, and it never enters evidence/audit/output).
const SUBJECT = "Aleksandr Zacharov";
// The Zakharov/Захаров transliteration case (TL-f5ebf6d8): the same sanctioned individual
// appears under Latin and Cyrillic name forms; the match response carries both candidates.
const MATCH_BODY = JSON.stringify({
  responses: {
    q: {
      results: [
        { id: "Q1", caption: "Alexander Vyacheslavovich ZAKHAROV", schema: "Person", datasets: ["us_ofac_sdn", "eu_fsf"], score: 0.95 },
        { id: "Q2", caption: "ЗАХАРОВ Александр Вячеславович", schema: "Person", datasets: ["ru_nsd_isin"], score: 0.72 },
        { id: "Q3", caption: "Alexander", schema: "Person", datasets: ["x"], score: 0.9 }, // single word: skipped (D-018)
        { id: "Q4", caption: "ZAKHAROV Alexander Vyacheslavovich", schema: "Vessel", datasets: ["x"], score: 0.9 }, // unknown schema: skipped
        { id: "Q5", caption: "No Score Person", schema: "Person", datasets: ["x"] }, // no score: skipped
      ],
    },
  },
});
const COMPANY_BODY = JSON.stringify({
  responses: { q: { results: [{ id: "C1", caption: "Rosbank AO", schema: "Company", datasets: ["us_ofac_sdn"], score: 0.88 }] } },
});
const SEARCH_BODY = JSON.stringify({
  results: [
    { id: "S1", caption: "Rosbank AO", schema: "Company", datasets: ["us_ofac_sdn"] },
    { id: "S2", caption: "Onecompany", schema: "Company", datasets: ["x"] }, // single word: skipped (D-018)
  ],
});

/** Anchored, escaped regex literals (the tr-005 pattern; see TR-023's CodeQL note). */
const MATCH_RE = /^https:\/\/api\.opensanctions\.org\/match\/default$/;
const SEARCH_RE = /^https:\/\/api\.opensanctions\.org\/search\/default\?fuzzy=true&limit=10&q=Rosbank%20AO$/;

function matchRoutes(): Array<{ match: RegExp | string; response: { status: number; body: string } }> {
  return [{ match: MATCH_RE, response: { status: 200, body: MATCH_BODY } }];
}

/** D-018: every emitted object value must satisfy its catalog type's own pattern. */
import { specById, matchesSpec } from "@ir/core/identifiers";

function expectCatalogValid(type: string, value: string): void {
  const spec = specById(type);
  if (!spec) throw new Error(`catalog type ${type} exists`);
  const m = matchesSpec(spec, value);
  expect(m.pattern, `${type} pattern accepts "${value}"`).toBe(true);
}

/**
 * ADR-28 condition 2: neither the API key nor the screening subject's name may appear anywhere
 * in the run result (evidence, findings' explanations, audit strings) — the body carries the
 * name and is never recorded; the findings carry the CANDIDATES (the product), not the subject.
 */
function expectNoCaseDataLeak(result: unknown): void {
  const json = JSON.stringify(result);
  expect(json).not.toContain(API_KEY);
  expect(json).not.toContain(SUBJECT);
  expect(json).not.toContain("ApiKey");
  expect(json).not.toContain("firstName");
}

describe("TR-025 opensanctions", () => {
  it("a person name screens via the ADR-28 /match POST: fixed-schema body, ApiKey header, scored candidates; the Zakharov/Захаров forms both match", async () => {
    const sim = createSimServer(matchRoutes());
    const result = await runTransform(opensanctions, { transport: sim.transport, input: { person_name: SUBJECT } });
    expect(result.requestCount).toBe(1);
    // The screening POST: the pinned host+path, the ADR-28 fixed JSON body (firstName/lastName
    // from the name — no free text beyond the name fields, no extra fields), the key in the
    // Authorization header only.
    const post = sim.requests[0];
    expect(post.method).toBe("POST");
    expect(post.url).toBe(`${API}/match/default`);
    expect(post.body).toBe(
      JSON.stringify({ queries: { q: { schema: "Person", properties: { firstName: ["Aleksandr"], lastName: ["Zacharov"] } } } }),
    );
    expect(post.headers?.authorization).toBe(`ApiKey ${API_KEY}`);
    // Findings: the two valid scored candidates (Latin + Cyrillic Zakharov forms); the single-word
    // caption, the unknown schema and the scoreless candidate are skipped (D-018 / shape).
    const findings = result.output.findings;
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      predicate: "matches_sanctions_entry",
      objectType: "person_name",
      objectValue: "Alexander Vyacheslavovich ZAKHAROV",
      confidence: 0.95,
    });
    expect(findings[1]).toMatchObject({ objectType: "person_name", objectValue: "ЗАХАРОВ Александр Вячеславович", confidence: 0.72 });
    for (const f of findings) expectCatalogValid(f.objectType, f.objectValue);
    // ADR-28 condition 3: the candidate COUNT and the scores enter the records (data.total +
    // confidence) — the response body itself (the candidates) does not.
    expect(result.output.data).toEqual({ total: 5 });
    // ADR-28 condition 2/3: the evidence record for the POST carries url/method/status ONLY —
    // no request body (the subject's name), no response body (the candidates), no key.
    expectNoCaseDataLeak(result);
    const evidence = result.evidence.find((e) => e.url === `${API}/match/default`);
    expect(evidence).toBeDefined();
    expect(evidence?.status).toBe(200);
    expect(evidence?.body).toBeUndefined();
  });

  it("a company name screens via the same /match POST with the Company schema", async () => {
    const sim = createSimServer([{ match: MATCH_RE, response: { status: 200, body: COMPANY_BODY } }]);
    const result = await runTransform(opensanctions, { transport: sim.transport, input: { company_name: "Rosbank AO" } });
    expect(result.requestCount).toBe(1);
    expect(sim.requests[0].body).toBe(JSON.stringify({ queries: { q: { schema: "Company", properties: { name: ["Rosbank AO"] } } } }));
    const findings = result.output.findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      predicate: "matches_sanctions_entry",
      objectType: "company_name",
      objectValue: "Rosbank AO",
      confidence: 0.88,
    });
    expectCatalogValid("company_name", findings[0].objectValue);
    expect(result.output.data).toEqual({ total: 1 });
    expectNoCaseDataLeak(result);
  });

  it("a company discovery run uses the /search GET (the non-person discovery path)", async () => {
    const sim = createSimServer([{ match: SEARCH_RE, response: { status: 200, body: SEARCH_BODY } }]);
    const result = await runTransform(opensanctions, { transport: sim.transport, input: { company_name: "Rosbank AO", mode: "search" } });
    expect(result.requestCount).toBe(1);
    expect(sim.requests[0].method).toBe("GET");
    expect(sim.requests[0].url).toBe(`${API}/search/default?fuzzy=true&limit=10&q=Rosbank%20AO`);
    expect(sim.requests[0].headers?.authorization).toBe(`ApiKey ${API_KEY}`);
    const findings = result.output.findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ predicate: "search_hit_sanctions_db", objectType: "company_name", objectValue: "Rosbank AO" });
    expectCatalogValid("company_name", findings[0].objectValue);
    expect(result.output.data).toEqual({ total: 2 });
  });

  it("person discovery via /search is refused: the name would travel in a recorded URL (match-only for persons)", async () => {
    const sim = createSimServer([{ match: SEARCH_RE, response: { status: 200, body: SEARCH_BODY } }]);
    await expect(
      runTransform(opensanctions, { transport: sim.transport, input: { person_name: SUBJECT, mode: "search" } }),
    ).rejects.toThrow(/person discovery via \/search is refused/);
    expect(sim.requestCount()).toBe(0);
  });

  it("without the API key the run fails closed BEFORE any transport call (zero requests)", async () => {
    const sim = createSimServer(matchRoutes());
    const key = process.env.IR_OPENSANCTIONS_TOKEN;
    delete process.env.IR_OPENSANCTIONS_TOKEN;
    try {
      await expect(runTransform(opensanctions, { transport: sim.transport, input: { person_name: SUBJECT } })).rejects.toThrow(
        /IR_OPENSANCTIONS_TOKEN/,
      );
      expect(sim.requestCount()).toBe(0);
    } finally {
      process.env.IR_OPENSANCTIONS_TOKEN = key;
    }
  });

  it("a 401 from /match rejects the run (an auth error is never an empty success)", async () => {
    const sim = createSimServer([{ match: MATCH_RE, response: { status: 401, body: JSON.stringify({ error: "unauthorized" }) } }]);
    await expect(runTransform(opensanctions, { transport: sim.transport, input: { person_name: SUBJECT } })).rejects.toThrow(
      /OpenSanctions rejected the API key/,
    );
  });

  it("a name that fails its catalog type rejects the run before any transport call", async () => {
    const sim = createSimServer(matchRoutes());
    await expect(runTransform(opensanctions, { transport: sim.transport, input: { person_name: "Singleword" } })).rejects.toThrow(
      /does not match its catalog type/,
    );
    expect(sim.requestCount()).toBe(0);
  });

  it("exactly one of person_name / company_name is required", async () => {
    const sim = createSimServer(matchRoutes());
    await expect(runTransform(opensanctions, { transport: sim.transport, input: {} })).rejects.toThrow(/exactly one/);
    await expect(
      runTransform(opensanctions, { transport: sim.transport, input: { person_name: SUBJECT, company_name: "Rosbank AO" } }),
    ).rejects.toThrow(/exactly one/);
    expect(sim.requestCount()).toBe(0);
  });

  it("a malformed /match response (no responses object) yields empty findings, no error", async () => {
    const sim = createSimServer([{ match: MATCH_RE, response: { status: 200, body: JSON.stringify({ results: [] }) } }]);
    const result = await runTransform(opensanctions, { transport: sim.transport, input: { person_name: SUBJECT } });
    expect(result.requestCount).toBe(1);
    expect(result.output.findings).toHaveLength(0);
    expect(result.output.data).toEqual({ total: 0 });
    expectNoCaseDataLeak(result);
  });
});

/**
 * The isolated path is the production path (`ir run --network` requires isolation), and the sandbox
 * does NOT inherit the parent's environment: without the manifest's `env` declaration the API key
 * could never reach the child. These tests prove the declared name arrives over IPC (the screening
 * POST the child builds), that the subject's name and the key never enter the recorded evidence,
 * and that without the key the run fails closed BEFORE any transport call.
 * Skipped where the sandbox cannot provide "full" isolation (the same rule as T-ISO).
 */
import { fileURLToPath } from "node:url";
import { probeIsolation } from "@ir/transform-sandbox";

const MODULE = fileURLToPath(new URL("./transforms/tr-025-opensanctions.ts", import.meta.url));
const isoHost = await probeIsolation();

describe.skipIf(!isoHost.full)("TR-025 isolated (production path: the sandbox does not inherit the parent env)", () => {
  it("the manifest-declared env name reaches the sandboxed child over IPC: the screening POST succeeds and the evidence stays case-data-free", async () => {
    const sim = createSimServer(matchRoutes());
    const result = await runTransform(undefined, {
      transport: sim.transport,
      input: { person_name: SUBJECT },
      requireIsolation: true,
      isolatedModule: MODULE,
      transformId: "TR-025",
    });
    expect(result.requestCount).toBe(1);
    expect(sim.requests[0].method).toBe("POST");
    expect(sim.requests[0].body).toBe(
      JSON.stringify({ queries: { q: { schema: "Person", properties: { firstName: ["Aleksandr"], lastName: ["Zacharov"] } } } }),
    );
    expect(sim.requests[0].headers?.authorization).toBe(`ApiKey ${API_KEY}`);
    // ADR-28: the POST's evidence record carries url/method/status only — the subject's name and
    // the key appear nowhere in the run result (no serialization to disk).
    const evidence = result.evidence.find((e) => e.url === `${API}/match/default`);
    expect(evidence?.body).toBeUndefined();
    expectNoCaseDataLeak(result);
    expect(result.output.findings).toHaveLength(2);
  });

  it("without the API key the sandboxed run fails closed before any transport call", async () => {
    const sim = createSimServer(matchRoutes());
    const key = process.env.IR_OPENSANCTIONS_TOKEN;
    delete process.env.IR_OPENSANCTIONS_TOKEN;
    try {
      await expect(
        runTransform(undefined, {
          transport: sim.transport,
          input: { person_name: SUBJECT },
          requireIsolation: true,
          isolatedModule: MODULE,
          transformId: "TR-025",
        }),
      ).rejects.toThrow(/IR_OPENSANCTIONS_TOKEN/);
      expect(sim.requestCount()).toBe(0);
    } finally {
      process.env.IR_OPENSANCTIONS_TOKEN = key;
    }
  });
});
