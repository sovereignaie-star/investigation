/**
 * P2-012 — TR-040: OpenSky Network (ICAO24 / flight callsign → flights).
 *
 * Source: the OpenSky Network REST API (opensky-network.org), free registered account (LC-C;
 * evaluation docs/tools/evaluations/TL-2b7cde30.md — the owner activated the free registration
 * 2026-10-16). Authentication is EXCLUSIVELY OAuth2 client-credentials (password grant rejected by
 * the source since 2026-03-18): the client_id/client_secret are read from the environment
 * (IR_OPENSKY_CLIENT_ID / IR_OPENSKY_CLIENT_SECRET) at run time — never stored in source — and
 * exchanged for a 30-minute Bearer token via an ADR-27 token POST to the pinned auth host
 * (auth.opensky-network.org). A run without either secret fails closed BEFORE any transport call
 * (the same rule as TR-023/TR-028). The token lives in the operator's memory only: it is never
 * put in a finding, never recorded in evidence (the recording transport records no body for the
 * token request), never serialized, never written to disk. The token body itself never enters
 * evidence or audit either.
 *
 * Two operations: an ICAO24 reads that aircraft's flights (1 token POST + 1 GET to
 * /api/flights/aircraft — a ≤2-day window ending 24h ago, because the source only serves flights
 * from the previous day or earlier); a CALLSIGN reads the live state vectors (1 token POST + 1 GET
 * to /api/states/all) and returns the matching aircraft's ICAO24 addresses, which the expansion
 * feeds back as ICAO24 subjects for the history path. A 401 from the API re-acquires the token
 * once and retries (the 30-minute expiry renewal); a second 401 fails the run.
 *
 * Aircraft and flights are not natural persons: sensitivity "normal" (E-02). A value that does
 * not satisfy its catalog type's pattern is skipped, never emitted as a claim (D-018).
 * All network I/O goes through `ctx.http` (egress gateway in production, ADR-08 + ADR-27).
 * Limits: rps 1, timeoutMs 15s, maxBytes 20MB (states/all is the large one).
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import type { TransformContext } from "../transform.ts";
import { matchesSpec, specById } from "@ir/core/identifiers";
import { parseJson } from "./util.ts";

const API = "https://opensky-network.org";
const TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

/** The client credentials, read from the environment at run time (never stored in source). */
function credentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.IR_OPENSKY_CLIENT_ID ?? "";
  const clientSecret = process.env.IR_OPENSKY_CLIENT_SECRET ?? "";
  if (clientId === "" || clientSecret === "") {
    throw new Error("TR-040: IR_OPENSKY_CLIENT_ID and IR_OPENSKY_CLIENT_SECRET must both be set (the free OpenSky API client)");
  }
  return { clientId, clientSecret };
}

/** An ICAO24 address: exactly 6 lower-case hex digits (the catalog type's own pattern). */
const ICAO24 = /^[0-9a-f]{6}$/;

interface SkyFlight {
  icao24?: string;
  callsign?: string;
  departureAirport?: string;
  arrivalAirport?: string;
  firstSeen?: number;
  lastSeen?: number;
}
/**
 * A state vector is a POSITIONAL array (the source's documented format):
 * [0]=icao24, [1]=callsign, [2]=origin_country, [5]=longitude, [6]=latitude, [7]=baro_altitude,
 * [8]=on_ground, [9]=velocity (m/s).
 */
type SkyStateVector = readonly unknown[];
interface TokenResponse {
  access_token?: string;
}

/** D-018: an emitted object value must satisfy its catalog type's own pattern, else it is skipped. */
function catalogValid(type: string, value: string): boolean {
  const spec = specById(type);
  return spec !== undefined && matchesSpec(spec, value).pattern === true;
}

/**
 * ADR-27: the OAuth2 client-credentials token POST. The body is built from the project's env
 * secrets only, in the fixed form the gateway's policy validates (grant_type, client_id,
 * client_secret). The response body (the access token) is returned to the caller in memory only
 * — the recording transport never records it in evidence.
 */
async function acquireToken(ctx: TransformContext): Promise<string> {
  const { clientId, clientSecret } = credentials();
  const body = `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`;
  const res = await ctx.http.post(TOKEN_URL, { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body);
  if (res.status === 401 || res.status === 403) {
    throw new Error(`TR-040: OpenSky rejected the client credentials (HTTP ${res.status})`);
  }
  if (res.status !== 200) throw new Error(`TR-040: unexpected HTTP ${res.status} from the OpenSky token endpoint`);
  const data = parseJson(res.body, "OpenSky token") as TokenResponse;
  if (typeof data.access_token !== "string" || data.access_token === "") {
    throw new Error("TR-040: the OpenSky token response carries no access_token");
  }
  return data.access_token;
}

/** One authenticated GET: 401 renews the token once; 404 is a not-found marker; 200 returns parsed JSON. */
async function apiGet(
  path: string,
  tokenRef: { value: string },
  ctx: TransformContext,
): Promise<{ status: number; data: unknown; requestId: number }> {
  const once = async (tok: string) => ctx.http.get(`${API}${path}`, { authorization: `Bearer ${tok}`, accept: "application/json" });
  let res = await once(tokenRef.value);
  if (res.status === 401) {
    // The 30-minute token expired mid-run: renew once and retry (never an empty success).
    tokenRef.value = await acquireToken(ctx);
    res = await once(tokenRef.value);
    if (res.status === 401 || res.status === 403) {
      throw new Error(`TR-040: OpenSky rejected the renewed token (HTTP ${res.status})`);
    }
  }
  if (res.status === 404) return { status: 404, data: null, requestId: res.requestId };
  if (res.status === 403) throw new Error("TR-040: OpenSky refused the request (HTTP 403)");
  if (res.status !== 200) throw new Error(`TR-040: unexpected HTTP ${res.status} from OpenSky`);
  return { status: 200, data: parseJson(res.body, "OpenSky"), requestId: res.requestId };
}

/** The ICAO24 operation: that aircraft's flights in a ≤2-day window ending 24h ago. */
async function byIcao24(icao24: string, tokenRef: { value: string }, ctx: TransformContext): Promise<TransformFinding[]> {
  const end = Math.floor(Date.now() / 1000) - 86_400; // yesterday: the source only serves completed days
  const begin = end - 86_400; // a 24h window (≤ the source's 2-day limit)
  const res = await apiGet(`/api/flights/aircraft?icao24=${icao24}&begin=${begin}&end=${end}`, tokenRef, ctx);
  if (res.status === 404) return []; // checked, not found: a negative result
  const flights = (Array.isArray(res.data) ? res.data : []) as SkyFlight[];
  const findings: TransformFinding[] = [];
  for (const f of flights.slice(0, 25)) {
    const callsign = typeof f.callsign === "string" ? f.callsign.trim().toUpperCase() : "";
    if (callsign === "") continue;
    if (!catalogValid("flight_callsign", callsign)) continue; // D-018
    findings.push({
      predicate: "operated_flight",
      objectType: "flight_callsign",
      objectValue: callsign,
      confidence: 0.9,
      explanation: `OpenSky: ${icao24} operated ${callsign} (${f.departureAirport ?? "???"} → ${f.arrivalAirport ?? "???"}, ${new Date((f.firstSeen ?? 0) * 1000).toISOString().slice(0, 10)})`,
      evidence: [res.requestId],
    });
  }
  return findings;
}

/** One matching state vector → an icao24 finding (undefined when the value fails the catalog pattern — D-018). */
function stateFinding(s: SkyStateVector, wanted: string, requestId: number): TransformFinding | undefined {
  const icao = typeof s[0] === "string" ? String(s[0]).trim().toLowerCase() : "";
  if (icao === "" || !ICAO24.test(icao)) return undefined; // D-018
  if (!catalogValid("icao24", icao)) return undefined;
  const onGround = s[8] === true;
  const baro = typeof s[7] === "number" ? Math.round(s[7]) : null;
  const velocity = typeof s[9] === "number" ? Math.round(s[9]) : null;
  return {
    predicate: "has_aircraft",
    objectType: "icao24",
    objectValue: icao,
    confidence: 0.85,
    explanation: `OpenSky: callsign ${wanted} is currently transmitted by ${icao}${onGround ? " (on ground)" : baro != null ? ` (baro ${baro}m${velocity != null ? `, ${velocity} m/s` : ""})` : ""}`,
    evidence: [requestId],
  };
}

/** The callsign operation: live state vectors filtered locally (the API has no callsign filter). */
async function byCallsign(callsign: string, tokenRef: { value: string }, ctx: TransformContext): Promise<TransformFinding[]> {
  const res = await apiGet("/api/states/all", tokenRef, ctx);
  if (res.status !== 200) return [];
  const states = (
    Array.isArray((res.data as { states?: unknown[] }).states) ? (res.data as { states?: unknown[] }).states : []
  ) as SkyStateVector[];
  const wanted = callsign.trim().toUpperCase();
  const findings: TransformFinding[] = [];
  for (const s of states) {
    const cs = typeof s[1] === "string" ? String(s[1]).trim().toUpperCase() : "";
    if (cs !== wanted) continue;
    const finding = stateFinding(s, wanted, res.requestId);
    if (finding) findings.push(finding);
    if (findings.length >= 10) break; // a callsign is one aircraft in practice; cap the noise
  }
  return findings;
}

export const opensky = defineTransform<{ icao24?: string; callsign?: string }>(
  {
    id: "TR-040",
    version: "1.0.0",
    inputs: ["icao24", "flight_callsign"],
    outputs: ["icao24", "flight_callsign"],
    network: { mode: "pinned", allow: ["auth.opensky-network.org", "opensky-network.org"] },
    secrets: [],
    // The sandbox does not inherit the parent's environment: both secrets are declared here so
    // the isolated runner forwards IR_OPENSKY_CLIENT_ID / IR_OPENSKY_CLIENT_SECRET (and only them)
    // to the child over IPC. Without either, the run fails closed before any transport call.
    env: ["IR_OPENSKY_CLIENT_ID", "IR_OPENSKY_CLIENT_SECRET"],
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 20_000_000 },
    sensitivity: "normal",
    license: "LC-C",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: {
      reliability: "D",
      credibility: 4,
      rationale: "شبكة OpenSky التطوعية لاستقبال ADS-B — ملاحظات أجهزة استقبال حقيقية بتغطية وتشغيل متفاوتين",
    },
  },
  async (input, ctx) => {
    const icao24 = typeof input.icao24 === "string" ? input.icao24.trim().toLowerCase() : undefined;
    const callsign = typeof input.callsign === "string" ? input.callsign.trim().toUpperCase() : undefined;
    if ((icao24 === undefined) === (callsign === undefined)) {
      throw new Error("TR-040: provide exactly one of icao24 or callsign");
    }

    if (icao24 !== undefined) {
      if (!ICAO24.test(icao24)) throw new Error(`TR-040: invalid ICAO24 address "${input.icao24}"`);
    } else if (callsign === undefined || callsign.length < 2 || callsign.length > 8) {
      throw new Error(`TR-040: invalid callsign "${input.callsign}"`);
    }

    // Fail-closed BEFORE any transport call: no credentials, no token POST, no API call.
    const token = { value: await acquireToken(ctx) };

    if (icao24 !== undefined) return { findings: await byIcao24(icao24, token, ctx) };
    return { findings: await byCallsign(callsign as string, token, ctx) };
  },
);
