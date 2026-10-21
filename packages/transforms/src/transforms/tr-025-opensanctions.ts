/**
 * TR-025 — OpenSanctions screening (P2-011).
 *
 * Value: https://api.opensanctions.org against sanctions + PEP lists (the whole database via
 * the `default` dataset) — scored name matching (the /match POST, ADR-28) and entity discovery
 * (the /search GET). The subject is a person name or a company name.
 *
 * ADR-28 (owner decision 2026-10-16) governs the POST:
 * - the screening POST goes ONLY to api.opensanctions.org/match/{dataset} (pinned host+path),
 *   with a body built from a FIXED schema (queries.q with schema Person|Company and name
 *   properties only — firstName/lastName for a person, name for a company). The body carries
 *   the subject's name — CASE DATA — so it never enters evidence, the audit trail or disk
 *   (the recording transport records {url, method, status} only for a POST), and the response
 *   body (candidate names) is never recorded either: what reaches the findings is the product
 *   (the candidates + scores), gated upstream by E-02 (natural_person_gate sensitivity).
 * - the /match endpoint is POST-only in the source (verified against the official OpenAPI
 *   spec); /search is the GET discovery path. Person discovery via /search is REFUSED here:
 *   the query would put the subject's name in a recorded URL (a name never travels in a
 *   recorded surface — only the ADR-28 screening body may carry it).
 * - the key (IR_OPENSANCTIONS_TOKEN) travels as an Authorization: ApiKey header (never in a
 *   URL); without it the run fails closed before any transport call.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import type { TransformContext } from "../transform.ts";
import { matchesSpec, specById } from "@ir/core/identifiers";
import { expectStatus, parseJson } from "./util.ts";

const BASE_URL = "https://api.opensanctions.org";
const ENV_KEY = "IR_OPENSANCTIONS_TOKEN";

export interface Tr025Input {
  /** A person name (multi-word, catalog person_name) — the screening subject. */
  readonly person_name?: string;
  /** A company name (multi-word, catalog company_name) — the screening subject. */
  readonly company_name?: string;
  /** "match" (default): the scored /match screening POST. "search": the /search GET discovery. */
  readonly mode?: "match" | "search";
}

interface MatchResult {
  readonly id: string;
  readonly caption?: string;
  readonly schema?: string;
  readonly datasets?: readonly string[];
  readonly score?: number;
}

interface SearchEntity {
  readonly id: string;
  readonly caption?: string;
  readonly schema?: string;
  readonly datasets?: readonly string[];
}

function catalogValid(type: string, value: string): boolean {
  const spec = specById(type);
  return spec !== undefined && matchesSpec(spec, value).pattern === true;
}

/** The candidate's object type from its schema — person/company names only (D-018 validated). */
function candidateType(schema: string | undefined): "person_name" | "company_name" | null {
  if (schema === "Person") return "person_name";
  if (schema === "Company" || schema === "LegalEntity" || schema === "Organization") return "company_name";
  return null;
}

/**
 * The ADR-28 screening body: a FIXED schema, no free text beyond the name fields, every field
 * typed and length-capped. A person name splits into firstName (first token) + lastName (the
 * rest); a company name goes in the single `name` property. The gateway rejects any other
 * shape, and widening it requires re-opening ADR-28 (its condition 7).
 */
function screeningBody(kind: "person" | "company", name: string): string {
  if (kind === "person") {
    const tokens = name.split(/\s+/).filter((t) => t !== "");
    const firstName = tokens[0] ?? "";
    const lastName = tokens.slice(1).join(" ");
    const properties: Record<string, string[]> =
      lastName === "" ? { firstName: [firstName] } : { firstName: [firstName], lastName: [lastName] };
    return JSON.stringify({ queries: { q: { schema: "Person", properties } } });
  }
  return JSON.stringify({ queries: { q: { schema: "Company", properties: { name: [name] } } } });
}

/** The /search GET discovery findings — entity names only (see the person refusal in the run). */
async function searchFindings(
  ctx: TransformContext,
  headers: Record<string, string>,
  name: string,
): Promise<{ findings: TransformFinding[]; data: { total: number } }> {
  const url = `${BASE_URL}/search/default?fuzzy=true&limit=10&q=${encodeURIComponent(name)}`;
  const res = await ctx.http.get(url, headers);
  expectStatus(res, [200], "OpenSanctions /search");
  const body = parseJson(res.body, "OpenSanctions /search") as { results?: readonly SearchEntity[] };
  const findings: TransformFinding[] = [];
  for (const e of body.results ?? []) {
    const objectType = candidateType(e.schema);
    if (objectType === null || e.caption === undefined) continue;
    if (!catalogValid(objectType, e.caption)) continue;
    findings.push({
      predicate: "search_hit_sanctions_db",
      objectType,
      objectValue: e.caption,
      confidence: 0.5,
      explanation: `OpenSanctions /search: entity ${e.id} (datasets: ${(e.datasets ?? []).join(", ")}) matches the query`,
      evidence: [res.requestId],
    });
  }
  // ADR-28 condition 3: the candidate COUNT enters the records (the response body itself does not)
  // — the raw count the source returned, not the post-D-018 findings count.
  const total = (body.results ?? []).length;
  return { findings, data: { total } };
}

/** The ADR-28 /match POST screening findings — the scored candidates (names + scores). */
async function matchFindings(
  ctx: TransformContext,
  headers: Record<string, string>,
  kind: "person" | "company",
  name: string,
): Promise<{ findings: TransformFinding[]; data: { total: number } }> {
  const body = screeningBody(kind, name);
  const res = await ctx.http.post(`${BASE_URL}/match/default`, headers, body);
  if (res.status === 401) throw new Error("TR-025: OpenSanctions rejected the API key");
  expectStatus(res, [200], "OpenSanctions /match");
  const parsed = parseJson(res.body, "OpenSanctions /match") as {
    responses?: Record<string, { results?: readonly MatchResult[] }>;
  };
  const results = parsed.responses?.["q"]?.results ?? [];
  const findings: TransformFinding[] = [];
  for (const r of results) {
    const objectType = candidateType(r.schema);
    if (objectType === null || r.caption === undefined) continue;
    if (!catalogValid(objectType, r.caption)) continue;
    const score = typeof r.score === "number" && r.score >= 0 && r.score <= 1 ? r.score : undefined;
    if (score === undefined) continue;
    findings.push({
      predicate: "matches_sanctions_entry",
      objectType,
      objectValue: r.caption,
      confidence: score,
      explanation: `OpenSanctions /match: entity ${r.id} matched (score ${score.toFixed(2)}, datasets: ${(r.datasets ?? []).join(", ")})`,
      evidence: [res.requestId],
    });
  }
  // ADR-28 condition 3: the candidate COUNT enters the records (the response body itself does not).
  return { findings, data: { total: results.length } };
}

export const opensanctions = defineTransform<Tr025Input>(
  {
    id: "TR-025",
    version: "1.0.0",
    inputs: ["person_name", "company_name"],
    outputs: ["person_name", "company_name"],
    network: { mode: "public", allow: [] },
    // The API key from the project secrets mechanism (IR_OPENSANCTIONS_TOKEN); isolated runs
    // receive it via IPC from the parent's env. Never in a URL — the Authorization header only.
    secrets: [],
    env: [ENV_KEY],
    // ADR-28 condition 4: the declared rate cap — rps 1 (no burst), i.e. at most 60 requests
    // per minute in theory and far fewer in practice; the free tier is the operational bound.
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 2_000_000 },
    sensitivity: "natural_person_gate",
    license: "LC-E",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: {
      reliability: "B",
      credibility: 3,
      rationale:
        "OpenSanctions يجمع قوائم عقوبات وسياسية رسمية بمنهجية موثقة — القوائم المصدر رسمية، والتجميع والمطابقة الاسمية درجاتها تقديرية مسجلة",
    },
  },
  async (input, ctx) => {
    const key = process.env[ENV_KEY] ?? "";
    // Fail-closed: no key, no request — the run ends before any transport call.
    if (key === "") throw new Error(`TR-025: ${ENV_KEY} is not set (fail-closed)`);

    const isPerson = input.person_name !== undefined;
    const isCompany = input.company_name !== undefined;
    if (isPerson === isCompany) {
      throw new Error("TR-025: exactly one of person_name / company_name is required");
    }
    const rawName = (isPerson ? input.person_name : input.company_name) ?? "";
    const name = rawName.trim();
    if (name.length < 3 || name.length > 200) throw new Error(`TR-025: invalid name length`);
    if (!catalogValid(isPerson ? "person_name" : "company_name", name)) {
      throw new Error("TR-025: the name does not match its catalog type");
    }

    const headers = { authorization: `ApiKey ${key}`, accept: "application/json" };

    if (input.mode === "search") {
      // /search is the GET discovery path — for ENTITY names only. A person name here would
      // travel in a recorded URL, which the name-protection rules (and ADR-28's body-only
      // exception) never allow: person screening is the /match POST.
      if (isPerson) {
        throw new Error(
          'TR-025: person discovery via /search is refused — the name would travel in a recorded URL; use the /match screening (mode "match")',
        );
      }
      return await searchFindings(ctx, headers, name);
    }

    // mode === "match" (default) — the ADR-28 screening POST: the subject's name in the
    // fixed-schema body (the ONE wire surface allowed to carry it).
    return await matchFindings(ctx, headers, isPerson ? "person" : "company", name);
  },
);
