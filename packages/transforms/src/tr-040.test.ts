import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { opensky } from "./transforms/tr-040-opensky.ts";
import { runTransform } from "./runner.ts";

// Synthetic OpenSky API-client credentials for the sim (never real secrets; the same fail-closed
// rule as TR-023/TR-028). The transform reads them from the environment at run time.
const CLIENT_ID = "sky-key-2026";
const CLIENT_SECRET = "sky-secret-2026";
process.env.IR_OPENSKY_CLIENT_ID = CLIENT_ID;
process.env.IR_OPENSKY_CLIENT_SECRET = CLIENT_SECRET;
const API = "https://opensky-network.org";
const TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const ACCESS_TOKEN = "synthetic-bearer-token-30min";

const TOKEN_BODY = JSON.stringify({ access_token: ACCESS_TOKEN, expires_in: 1800, token_type: "Bearer" });
const FLIGHTS = JSON.stringify([
  {
    icao24: "3c6444",
    callsign: "DLH2SR ",
    departureAirport: "EDDF",
    arrivalAirport: "EDDF",
    firstSeen: 1760000000,
    lastSeen: 1760005400,
  },
  { icao24: "3c6444", callsign: "", departureAirport: "EDDF", arrivalAirport: "EDDM" }, // empty callsign: skipped
  {
    icao24: "3c6444",
    callsign: "TOOMANYCHARS9", // fails the catalog pattern: skipped (D-018)
    departureAirport: "EDDF",
    arrivalAirport: "EDDM",
  },
]);
const STATES = JSON.stringify({
  time: 1760000000,
  states: [
    ["3c6444", "DLH2SR ", "GERMANY", 1760000000, 1760000100, 10.0, 50.0, 11000, false, 0, 0, null, null, null],
    ["a1b2c3", "UAL123 ", "UNITED STATES", 1760000000, 1760000100, -73.0, 40.0, 9000, true, 0, 0, null, null, null],
    ["bad24", "DLH2SR ", "X", 1760000000, 1760000100, 0, 0, 0, false, 0, 0, null, null, null], // not an icao24: skipped (D-018)
  ],
});

/** Anchored, escaped regex literals (the tr-005 pattern; see TR-023's CodeQL note). */
const TOKEN_RE = /^https:\/\/auth\.opensky-network\.org\/auth\/realms\/opensky-network\/protocol\/openid-connect\/token$/;
const FLIGHTS_RE = /^https:\/\/opensky-network\.org\/api\/flights\/aircraft\?icao24=3c6444&begin=\d{10}&end=\d{10}$/;
const STATES_RE = /^https:\/\/opensky-network\.org\/api\/states\/all$/;

function tokenRoute(): Array<{ match: RegExp | string; response: { status: number; body: string } }> {
  return [{ match: TOKEN_RE, response: { status: 200, body: TOKEN_BODY } }];
}
function icao24Routes(): Array<{ match: RegExp | string; response: { status: number; body: string } }> {
  return [...tokenRoute(), { match: FLIGHTS_RE, response: { status: 200, body: FLIGHTS } }];
}
function callsignRoutes(): Array<{ match: RegExp | string; response: { status: number; body: string } }> {
  return [...tokenRoute(), { match: STATES_RE, response: { status: 200, body: STATES } }];
}

/** D-018: every emitted object value must satisfy its catalog type's own pattern. */
import { specById, matchesSpec } from "@ir/core/identifiers";

function expectCatalogValid(type: string, value: string): void {
  const spec = specById(type);
  if (!spec) throw new Error(`catalog type ${type} exists`);
  const m = matchesSpec(spec, value);
  expect(m.pattern, `${type} pattern accepts "${value}"`).toBe(true);
}

/** ADR-27: neither the client secret, the body, nor the access token may appear anywhere in the run result. */
function expectNoSecretLeak(result: unknown): void {
  const json = JSON.stringify(result);
  expect(json).not.toContain(CLIENT_SECRET);
  expect(json).not.toContain(ACCESS_TOKEN);
  expect(json).not.toContain("client_secret");
  expect(json).not.toContain("grant_type");
}

describe("TR-040 opensky", () => {
  it("an ICAO24 yields that aircraft's flights (1 token POST + 1 GET); the token body is fixed and the secret never leaks", async () => {
    const sim = createSimServer(icao24Routes());
    const result = await runTransform(opensky, { transport: sim.transport, input: { icao24: "3C6444" } });
    expect(result.requestCount).toBe(2);
    // The token POST: fixed ADR-27 form body, built from the env secrets only.
    const token = sim.requests[0];
    expect(token.method).toBe("POST");
    expect(token.url).toBe(TOKEN_URL);
    expect(token.body).toBe(`grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`);
    // The flights GET: Bearer token in the Authorization header, the subject lower-cased in the query.
    const flights = sim.requests[1];
    expect(flights.method).toBe("GET");
    expect(flights.url).toContain("icao24=3c6444");
    expect(flights.headers?.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    // Findings: one per valid callsign (empty + pattern-failing callsigns skipped — D-018).
    const findings = result.output.findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ predicate: "operated_flight", objectType: "flight_callsign", objectValue: "DLH2SR" });
    expectCatalogValid("flight_callsign", findings[0].objectValue);
    // The evidence's token record carries url/method/status ONLY — no body, no token, no secret.
    expectNoSecretLeak(result);
    const tokenEvidence = result.evidence.find((e) => e.url === TOKEN_URL);
    expect(tokenEvidence).toBeDefined();
    expect(tokenEvidence?.body).toBeUndefined();
    expect(tokenEvidence?.status).toBe(200);
  });

  it("a callsign yields the live aircraft (state vectors filtered locally); the icao24 feeds the history path", async () => {
    const sim = createSimServer(callsignRoutes());
    const result = await runTransform(opensky, { transport: sim.transport, input: { callsign: "dlh2sr" } });
    expect(result.requestCount).toBe(2);
    expect(sim.requests[1].url).toBe(`${API}/api/states/all`);
    const findings = result.output.findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ predicate: "has_aircraft", objectType: "icao24", objectValue: "3c6444" });
    expectCatalogValid("icao24", findings[0].objectValue);
    expectNoSecretLeak(result);
  });

  it("without the client credentials the run fails closed BEFORE any transport call (zero requests)", async () => {
    const sim = createSimServer(icao24Routes());
    const id = process.env.IR_OPENSKY_CLIENT_ID;
    const secret = process.env.IR_OPENSKY_CLIENT_SECRET;
    delete process.env.IR_OPENSKY_CLIENT_ID;
    delete process.env.IR_OPENSKY_CLIENT_SECRET;
    try {
      await expect(runTransform(opensky, { transport: sim.transport, input: { icao24: "3c6444" } })).rejects.toThrow(
        /IR_OPENSKY_CLIENT_ID and IR_OPENSKY_CLIENT_SECRET/,
      );
      expect(sim.requestCount()).toBe(0);
    } finally {
      process.env.IR_OPENSKY_CLIENT_ID = id;
      process.env.IR_OPENSKY_CLIENT_SECRET = secret;
    }
  });

  it("a 401 from the token endpoint rejects the run (an auth error is never an empty success)", async () => {
    const sim = createSimServer([{ match: TOKEN_RE, response: { status: 401, body: JSON.stringify({ error: "invalid_client" }) } }]);
    await expect(runTransform(opensky, { transport: sim.transport, input: { icao24: "3c6444" } })).rejects.toThrow(
      /OpenSky rejected the client credentials/,
    );
  });

  it("a token response without an access_token rejects the run", async () => {
    const sim = createSimServer([{ match: TOKEN_RE, response: { status: 200, body: JSON.stringify({ error: "unexpected" }) } }]);
    await expect(runTransform(opensky, { transport: sim.transport, input: { icao24: "3c6444" } })).rejects.toThrow(
      /carries no access_token/,
    );
  });

  it("a 401 from the API renews the token once and retries (the 30-minute expiry renewal)", async () => {
    // `times: 1` consumes the first rules, so the renewed token POST and the retried flights GET
    // fall through to the later rules (the sim's ordered, stateful matching).
    const sim = createSimServer([
      { match: TOKEN_RE, response: { status: 200, body: TOKEN_BODY }, times: 1 },
      { match: FLIGHTS_RE, response: { status: 401, body: "" }, times: 1 },
      { match: TOKEN_RE, response: { status: 200, body: JSON.stringify({ access_token: "renewed-token", expires_in: 1800 }) } },
      { match: FLIGHTS_RE, response: { status: 200, body: FLIGHTS } },
    ]);
    const result = await runTransform(opensky, { transport: sim.transport, input: { icao24: "3c6444" } });
    expect(result.requestCount).toBe(4); // token, flights(401), token(renewed), flights
    expect(sim.requests[1].headers?.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(sim.requests[3].headers?.authorization).toBe("Bearer renewed-token");
    expect(result.output.findings).toHaveLength(1);
    expectNoSecretLeak(result);
  });

  it("a 404 from the flights endpoint is a negative result: empty findings, no error", async () => {
    const sim = createSimServer([...tokenRoute(), { match: FLIGHTS_RE, response: { status: 404, body: "" } }]);
    const result = await runTransform(opensky, { transport: sim.transport, input: { icao24: "3c6444" } });
    expect(result.requestCount).toBe(2);
    expect(result.output.findings).toHaveLength(0);
    expectNoSecretLeak(result);
  });
});

// helper for the fail-closed test: the recording transport's evidence is inaccessible from the sim;
// zero sim requests already proves zero transport calls.

/**
 * The isolated path is the production path (`ir run --network` requires isolation), and the sandbox
 * does NOT inherit the parent's environment: without the manifest's `env` declaration the client
 * credentials could never reach the child. These tests prove the declared names arrive over IPC
 * (the token POST the child builds), that the token/body never enter the recorded evidence, and
 * that without them the run fails closed BEFORE any transport call.
 * Skipped where the sandbox cannot provide "full" isolation (same rule as T-ISO).
 */
import { fileURLToPath } from "node:url";
import { probeIsolation } from "@ir/transform-sandbox";

const MODULE = fileURLToPath(new URL("./transforms/tr-040-opensky.ts", import.meta.url));
const isoHost = await probeIsolation();

describe.skipIf(!isoHost.full)("TR-040 isolated (production path: the sandbox does not inherit the parent env)", () => {
  it("the manifest-declared env names reach the sandboxed child over IPC: the token POST succeeds and the body/evidence stay secret-free", async () => {
    const sim = createSimServer(icao24Routes());
    const result = await runTransform(undefined, {
      transport: sim.transport,
      input: { icao24: "3c6444" },
      requireIsolation: true,
      isolatedModule: MODULE,
      transformId: "TR-040",
    });
    expect(result.requestCount).toBe(2);
    expect(sim.requests[0].method).toBe("POST");
    expect(sim.requests[0].body).toBe(`grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`);
    expect(sim.requests[1].headers?.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    // ADR-27: the token request's evidence record carries url/method/status only — the access
    // token and the client secret appear nowhere in the run result (no serialization).
    const tokenEvidence = result.evidence.find((e) => e.url === TOKEN_URL);
    expect(tokenEvidence?.body).toBeUndefined();
    expectNoSecretLeak(result);
    expect(result.output.findings).toHaveLength(1);
  });

  it("without the client credentials the sandboxed run fails closed before any transport call", async () => {
    const sim = createSimServer(icao24Routes());
    const id = process.env.IR_OPENSKY_CLIENT_ID;
    const secret = process.env.IR_OPENSKY_CLIENT_SECRET;
    delete process.env.IR_OPENSKY_CLIENT_ID;
    delete process.env.IR_OPENSKY_CLIENT_SECRET;
    try {
      await expect(
        runTransform(undefined, {
          transport: sim.transport,
          input: { icao24: "3c6444" },
          requireIsolation: true,
          isolatedModule: MODULE,
          transformId: "TR-040",
        }),
      ).rejects.toThrow(/IR_OPENSKY_CLIENT_ID and IR_OPENSKY_CLIENT_SECRET/);
      expect(sim.requestCount()).toBe(0);
    } finally {
      process.env.IR_OPENSKY_CLIENT_ID = id;
      process.env.IR_OPENSKY_CLIENT_SECRET = secret;
    }
  });
});
