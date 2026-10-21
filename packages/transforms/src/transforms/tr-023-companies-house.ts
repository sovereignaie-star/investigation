/**
 * P2-011 — TR-023: Companies House (UK company number/name → company, officers, PSC).
 *
 * Source: the official UK Companies House REST API (api.company-information.service.gov.uk),
 * free developer key (LC-C; evaluation docs/tools/evaluations/TL-4b0199a8.md — the owner
 * activated the free registration 2026-10-16). The key is NOT stored in source: it is read
 * from the environment (IR_COMPANIES_HOUSE_TOKEN) at run time and sent only as an
 * Authorization header (Basic auth with the key as the username), never in a URL. A run
 * without it fails closed before any transport call (the same rule as TR-028's keyed
 * source). The manifest declares the env name so the isolated runner forwards only it.
 *
 * Two operations: a company NUMBER reads the profile, the officers and the PSC register
 * (3 requests); a company NAME searches the register (1 request) and returns matching
 * company numbers, which the expansion feeds back as number subjects.
 *
 * Officers and PSCs are natural persons: the transform is natural_person_gate (E-02) —
 * the engine refuses it without a purpose confirmation, and its person-name findings
 * never become expansion nodes (D-018). A value that does not satisfy its catalog
 * type's pattern is skipped, never emitted as a claim.
 * All network I/O goes through `ctx.http` (egress gateway in production, ADR-08).
 * Limits: rps 1, timeoutMs 15s, maxBytes 2MB.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import type { TransformContext } from "../transform.ts";
import { matchesSpec, specById } from "@ir/core/identifiers";
import { parseJson } from "./util.ts";

const API = "https://api.company-information.service.gov.uk";

/**
 * The Companies House developer key, read from the environment at run time (never stored in
 * source; the owner delivers it through the approved secret mechanism). Sent as Basic auth
 * with the key as the username — a header, never a URL parameter.
 */
function authHeaders(): Record<string, string> {
  const token = process.env.IR_COMPANIES_HOUSE_TOKEN ?? "";
  if (token === "") {
    throw new Error("TR-023: IR_COMPANIES_HOUSE_TOKEN is not set (the free Companies House developer key)");
  }
  return { Authorization: `Basic ${btoa(`${token}:`)}` };
}

/** A company number: 8 digits or 2 letters + 6 digits (the catalog type's own pattern). */
const COMPANY_NUMBER = /^(?:\d{8}|[A-Za-z]{2}\d{6})$/;

interface ChAddress {
  address_line_1?: string;
  address_line_2?: string;
  locality?: string;
  postal_code?: string;
  country?: string;
}
interface ChProfile {
  company_name?: string;
  company_number?: string;
  company_status?: string;
  type?: string;
  date_of_creation?: string;
  registered_office_address?: ChAddress;
}
interface ChOfficer {
  name?: string;
  officer_role?: string;
  appointed_on?: string;
  resigned_on?: string;
}
interface ChPsc {
  name?: string;
  natures_of_control?: string[];
  ceased_on?: string;
}
interface ChSearchItem {
  company_number?: string;
  company_name?: string;
  company_status?: string;
}

/** D-018: an emitted object value must satisfy its catalog type's own pattern, else it is skipped. */
function catalogValid(type: string, value: string): boolean {
  const spec = specById(type);
  return spec !== undefined && matchesSpec(spec, value).pattern === true;
}

function registeredOffice(profile: ChProfile, requestId: number): TransformFinding | undefined {
  const a = profile.registered_office_address;
  const parts = [a?.address_line_1, a?.address_line_2, a?.locality, a?.postal_code, a?.country].filter(
    (p): p is string => typeof p === "string" && p !== "",
  );
  if (parts.length === 0) return undefined;
  const address = parts.join(", ");
  if (!catalogValid("street_address", address)) return undefined;
  return {
    predicate: "has_registered_office",
    objectType: "street_address",
    objectValue: address,
    confidence: 0.9,
    explanation: `Companies House: registered office of ${profile.company_name ?? profile.company_number} is ${address}`,
    evidence: [requestId],
  };
}

function activeOfficers(items: ChOfficer[], requestId: number): TransformFinding[] {
  const out: TransformFinding[] = [];
  for (const o of items) {
    if (!o.name || o.resigned_on) continue; // active officers only
    if (!catalogValid("person_name", o.name)) continue;
    out.push({
      predicate: "has_officer",
      objectType: "person_name",
      objectValue: o.name,
      confidence: 0.9,
      explanation: `Companies House: ${o.name} is an active ${o.officer_role ?? "officer"} (appointed ${o.appointed_on ?? "unknown date"})`,
      evidence: [requestId],
    });
  }
  return out;
}

function activePscs(items: ChPsc[], requestId: number): TransformFinding[] {
  const out: TransformFinding[] = [];
  for (const p of items) {
    if (!p.name || p.ceased_on) continue; // active PSCs only
    if (!catalogValid("person_name", p.name)) continue;
    out.push({
      predicate: "has_psc",
      objectType: "person_name",
      objectValue: p.name,
      confidence: 0.9,
      explanation: `Companies House: ${p.name} is a person with significant control (${p.natures_of_control?.join("; ") ?? "natures of control not stated"})`,
      evidence: [requestId],
    });
  }
  return out;
}

/** One GET: 404 is a not-found marker; 401/403 is an auth error; 200 returns parsed JSON. */
async function getJson(path: string, ctx: TransformContext): Promise<{ status: number; data: unknown; requestId: number }> {
  const res = await ctx.http.get(`${API}${path}`, authHeaders());
  if (res.status === 404) return { status: 404, data: null, requestId: res.requestId };
  if (res.status === 401 || res.status === 403) {
    throw new Error(`TR-023: Companies House rejected the key (HTTP ${res.status})`);
  }
  if (res.status !== 200) throw new Error(`TR-023: unexpected HTTP ${res.status} from Companies House`);
  return { status: 200, data: parseJson(res.body, "Companies House"), requestId: res.requestId };
}

/** The company-number operation: profile + officers + PSC (3 requests). */
async function byNumber(number: string, ctx: TransformContext): Promise<TransformFinding[]> {
  const profile = await getJson(`/company/${number}`, ctx);
  if (profile.status === 404) return []; // checked, not found: a negative result
  const p = profile.data as ChProfile;
  if (!p.company_name) return [];
  const findings: TransformFinding[] = [];
  if (catalogValid("company_name", p.company_name)) {
    findings.push({
      predicate: "has_registered_name",
      objectType: "company_name",
      objectValue: p.company_name,
      confidence: 0.95,
      explanation: `Companies House: ${p.company_name} (${p.company_status ?? "unknown status"}, incorporated ${p.date_of_creation ?? "unknown date"}, type ${p.type ?? "unknown"})`,
      evidence: [profile.requestId],
    });
  }
  const office = registeredOffice(p, profile.requestId);
  if (office) findings.push(office);
  const officers = await getJson(`/company/${number}/officers?items_per_page=50`, ctx);
  if (officers.status === 200) {
    findings.push(...activeOfficers((officers.data as { items?: ChOfficer[] }).items ?? [], officers.requestId));
  }
  const psc = await getJson(`/company/${number}/persons-with-significant-control?items_per_page=50`, ctx);
  if (psc.status === 200) {
    findings.push(...activePscs((psc.data as { items?: ChPsc[] }).items ?? [], psc.requestId));
  }
  return findings;
}

/** The company-name operation: a register search (1 request) returning matching numbers. */
async function byName(name: string, ctx: TransformContext): Promise<TransformFinding[]> {
  const search = await getJson(`/search/companies?q=${encodeURIComponent(name)}&items_per_page=10`, ctx);
  if (search.status !== 200) return [];
  const items = ((search.data as { items?: ChSearchItem[] }).items ?? []).slice(0, 5);
  const findings: TransformFinding[] = [];
  for (const it of items) {
    if (!it.company_number || !COMPANY_NUMBER.test(it.company_number)) continue;
    findings.push({
      predicate: "has_registration_number",
      objectType: "uk_company_number",
      objectValue: it.company_number.toUpperCase(),
      confidence: 0.9,
      explanation: `Companies House: "${it.company_name ?? it.company_number}" is registered as ${it.company_number.toUpperCase()} (${it.company_status ?? "unknown status"})`,
      evidence: [search.requestId],
    });
  }
  return findings;
}

export const companiesHouse = defineTransform<{ company_number?: string; name?: string }>(
  {
    id: "TR-023",
    version: "1.0.0",
    inputs: ["uk_company_number", "company_name"],
    outputs: ["uk_company_number", "company_name", "street_address", "person_name"],
    network: { mode: "pinned", allow: ["api.company-information.service.gov.uk"] },
    secrets: [],
    // The sandbox does not inherit the parent's environment: the key is declared here so the
    // isolated runner forwards IR_COMPANIES_HOUSE_TOKEN (and only it) to the child over IPC.
    // Without it the run fails closed before any transport call.
    env: ["IR_COMPANIES_HOUSE_TOKEN"],
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 2_000_000 },
    sensitivity: "natural_person_gate",
    license: "LC-C",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: {
      reliability: "A",
      credibility: 1,
      rationale: "سجل الشركات البريطاني الرسمي (Companies House) — السجل القانوني الأولي لبيانات الشركات",
    },
  },
  async (input, ctx) => {
    const number = typeof input.company_number === "string" ? input.company_number.trim().toUpperCase() : undefined;
    const name = typeof input.name === "string" ? input.name.trim() : undefined;
    if ((number === undefined) === (name === undefined)) {
      throw new Error("TR-023: provide exactly one of company_number or name");
    }

    if (number !== undefined) {
      if (!COMPANY_NUMBER.test(number)) throw new Error(`TR-023: invalid company number "${input.company_number}"`);
      return { findings: await byNumber(number, ctx) };
    }

    // Name search: the subject is the company name (validated by the catalog pattern).
    if (name === undefined || name.length < 3 || name.length > 200) {
      throw new Error(`TR-023: invalid company name "${input.name}"`);
    }
    return { findings: await byName(name, ctx) };
  },
);
