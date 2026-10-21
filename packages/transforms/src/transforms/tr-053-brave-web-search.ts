/**
 * TR-053 — Brave web search (P2-026, batch 5 — the restricted-storage provider).
 *
 * Value: https://api.search.brave.com — the general web search. The transform searches the web
 * for ONE subject (a person's name or a domain) and emits the result LINKS as url entities that
 * expand the investigation graph. Minimal collection: the result TITLES and DESCRIPTIONS are
 * deliberately NOT read — only the links (the owner decision 2026-10-17: "استعلام + روابط +
 * hash فقط، لا محتوى خام").
 *
 * THE RESTRICTED EVIDENCE STORAGE (the owner decision — Brave's terms): the Search API terms
 * forbid storing Search Results ("Customer shall not ... store, cache, or create a database of
 * Search Results, in whole or in part" — verified 2026-10-17 against
 * https://api-dashboard.search.brave.com/documentation/resources/terms-of-service). The manifest
 * therefore declares restrictedEvidence: the RUNNER replaces the raw response body in the
 * evidence record with a sha256 digest envelope — the query (the request URL), the time, the
 * links (the findings) and the hash are stored; the raw content is not. The transform itself
 * cannot bypass this: the recording happens outside the sandbox.
 *
 * The key (BRAVE_SUBSCRIPTION_TOKEN) travels ONLY in the `X-Subscription-Token` header (the
 * source's documented auth — verified 2026-10-17 against
 * https://api-dashboard.search.brave.com/documentation/guides/authentication), injected by the
 * egress gateway from the vault (pinned mode, ADR-08 §7); the transform never sees or embeds it.
 * The request sends ONLY the `q` query parameter — the source's many other documented parameters
 * (count, offset, freshness, ...) are deliberately NOT sent: the closed allowlist is narrower
 * than the provider's documented surface on purpose (fail-closed; the urlscan q-only pattern).
 *
 * Source facts (verified 2026-10-17): GET /res/v1/web/search with q; the response carries
 * web.results[] with url/title/description. The free tier is quota-limited (1 query/second,
 * monthly caps by plan) — the manifest's rps 1 is OUR declared bound within that.
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { parseJson, expectStatus } from "./util.ts";

const BRAVE_WEB_SEARCH = "https://api.search.brave.com/res/v1/web/search";

export interface Tr053Input {
  /** A person's name (catalog person_name — a screening subject, the E-02 gate applies). */
  readonly name?: string;
  /** A DNS domain (catalog domain). */
  readonly domain?: string;
}

interface BraveWebResult {
  readonly url?: unknown;
}

/** A trimmed non-empty string not longer than the declared bound. */
function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  return v === "" || v.length > max ? undefined : v;
}

/** The validated search subject: exactly one of name or domain. */
type SearchSubject = { kind: "name"; value: string } | { kind: "domain"; value: string };
function searchSubject(input: Tr053Input): SearchSubject {
  const nameSet = input.name !== undefined && input.name !== null && input.name !== "";
  const domainSet = input.domain !== undefined && input.domain !== null && input.domain !== "";
  if (!nameSet && !domainSet) throw new Error("TR-053: exactly one of name or domain is required");
  if (nameSet && domainSet) throw new Error("TR-053: only one of name or domain may be set");
  return nameSet ? { kind: "name", value: validateName(input.name ?? "") } : { kind: "domain", value: validateDomain(input.domain ?? "") };
}

/** A person's name: 3..200 characters (the registry's person_name bound). */
function validateName(raw: string): string {
  const name = raw.trim();
  if (name.length < 3 || name.length > 200) {
    throw new Error(`TR-053: "${raw.slice(0, 40)}" is not a person name`);
  }
  return name;
}

/** A DNS domain: LDH labels, at most 253 characters, at least one dot. */
function validateDomain(raw: string): string {
  const domain = raw.trim().toLowerCase();
  if (domain === "" || domain.length > 253 || !/^[a-z0-9.-]+$/.test(domain) || !domain.includes(".")) {
    throw new Error(`TR-053: "${raw}" is not a valid domain`);
  }
  return domain;
}

/** An http(s) URL (a result link): the only shape ever claimed. */
function resultUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const url = cleanText(value, 2048);
  if (url === undefined) return undefined;
  if (!/^https:\/\//i.test(url) && !/^http:\/\//i.test(url)) return undefined;
  return url;
}

export const braveWebSearch = defineTransform<Tr053Input>(
  {
    id: "TR-053",
    version: "1.0.0",
    inputs: ["person_name", "domain"],
    outputs: ["url"],
    network: { mode: "pinned", allow: ["api.search.brave.com"] },
    secrets: ["BRAVE_SUBSCRIPTION_TOKEN"],
    // OUR declared bound within the source's documented 1 query/second.
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 1_000_000 },
    // The response carries web results about people — the natural-person gate applies (the
    // TR-051 precedent: the gate is the transform's, whatever the subject kind).
    sensitivity: "natural_person_gate",
    license: "LC-D",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: {
      reliability: "C",
      credibility: 4,
      rationale: "بحث Brave التجاري العام — روابط نتائج فعلية، لكن الترتيب والشمول تجاريان وليسا ادعاءات واقعية",
    },
    // The owner decision 2026-10-17: Brave's terms forbid storing Search Results — the runner
    // keeps the raw response out of the records (a sha256 envelope instead).
    restrictedEvidence: true,
  },
  async (input, ctx) => {
    const subject = searchSubject(input);
    const query = subject.value;
    const res = await ctx.http.get(`${BRAVE_WEB_SEARCH}?q=${encodeURIComponent(query)}`);
    expectStatus(res, [200], "Brave web search");
    const parsed = parseJson(res.body, "Brave web search") as { web?: unknown };
    const web = parsed.web;
    if (web === undefined || web === null || typeof web !== "object") {
      throw new Error("TR-053: Brave web search returned a malformed response (no web object)");
    }
    const results = (web as { results?: unknown }).results;
    if (results !== undefined && !Array.isArray(results)) {
      throw new Error("TR-053: Brave web search returned a malformed response (results is not an array)");
    }
    const findings: TransformFinding[] = [];
    for (const raw of (results as readonly unknown[]) ?? []) {
      if (raw === null || typeof raw !== "object") continue;
      const url = resultUrl((raw as BraveWebResult).url);
      // A result without a valid http(s) URL is skipped, never guessed (D-018).
      if (url === undefined) continue;
      findings.push({
        predicate: "mentioned_in",
        evidence: [res.requestId],
        objectType: "url",
        objectValue: url,
        confidence: 0.6,
        explanation: `Brave web search: the subject appears in the web result ${url}`,
      });
    }
    return { findings };
  },
);
