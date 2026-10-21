/**
 * TR-051 — Hunter public domain emails (P2-026, batch 5).
 *
 * Value: https://hunter.io — the public email discovery service. The transform searches one
 * domain and emits a finding per email the source publishes for it, plus the domain's observed
 * email pattern (the "{first}"-style template the source derives from its corpus).
 *
 * The key (HUNTER_KEY) travels ONLY in the `X-API-KEY` header (the source's documented
 * alternative to the api_key query parameter — verified against the official API reference
 * 2026-10-17), injected by the egress gateway from the vault (the manifest's `secrets` binding —
 * pinned mode, ADR-08 §7); the transform never sees or embeds it. The request sends ONLY the
 * `domain` query parameter — the source's pagination/filter parameters (`limit`, `offset`,
 * `type`, ...) are deliberately NOT sent: the closed per-provider allowlist is narrower than the
 * provider's documented surface on purpose (fail-closed; the TR-044 ipAddress pattern).
 *
 * Sensitivity is `natural_person_gate` (E-02): a public email identifies a person. The subject
 * is a domain (catalog sensitivity normal); the manifest's gate tag records the data class the
 * RESPONSE carries. Minimal collection: only the email values, their source confidence and the
 * pattern are used — the response's richer personal fields (first/last name, phone, social
 * profiles) are read by no code path here.
 *
 * The source documents the endpoint at 15 requests/second and 500/minute; the manifest's rps 1
 * is OUR declared bound (the free plan's monthly quota is the real operational ceiling).
 */
import { defineTransform } from "../manifest.ts";
import type { TransformFinding } from "../output.ts";
import { isEmail, normalizeDomain, parseJson, expectStatus } from "./util.ts";

const HUNTER_DOMAIN_SEARCH = "https://api.hunter.io/v2/domain-search";

export interface Tr051Input {
  /** A registrable domain (catalog domain). */
  readonly domain: string;
}

interface HunterEmail {
  readonly value?: string;
  readonly type?: string;
  readonly confidence?: number;
}

interface HunterData {
  readonly domain?: string | null;
  readonly pattern?: string | null;
  readonly emails?: readonly HunterEmail[];
}

/** The domain-level pattern finding — the observed "{first}"-style email template of the domain. */
function patternFinding(domain: string, pattern: string, requestId: number): TransformFinding | undefined {
  const p = pattern.trim();
  if (p === "" || p.length > 64) return undefined;
  return {
    predicate: "has_email_pattern",
    evidence: [requestId],
    objectType: "domain",
    objectValue: domain,
    confidence: 0.7,
    explanation: `Hunter: ${domain} emails follow the pattern ${p}`,
  };
}

/** One finding per published, well-formed email — the source's own confidence maps directly
 *  (the TR-047/TR-044 precedent). Invalid values are skipped, never emitted (D-018). Minimal
 *  collection: only the email value and the source's confidence enter the finding — the response's
 *  richer personal fields (first/last name, position, phone, social profiles) are read by no code
 *  path here. */
function emailFindings(data: HunterData, requestId: number): TransformFinding[] {
  const findings: TransformFinding[] = [];
  const seen = new Set<string>();
  for (const email of data.emails ?? []) {
    const value = typeof email.value === "string" ? email.value.trim().toLowerCase() : "";
    if (value === "" || !isEmail(value) || seen.has(value)) continue;
    seen.add(value);
    const confidence =
      typeof email.confidence === "number" && email.confidence >= 0 && email.confidence <= 100 ? email.confidence / 100 : 0.5;
    const kind = email.type === "generic" ? "role-based" : "personal";
    findings.push({
      predicate: "has_public_email",
      evidence: [requestId],
      objectType: "email",
      objectValue: value,
      confidence,
      explanation: `Hunter: ${value} is a published ${kind} email`,
    });
  }
  return findings;
}

/** The validated Hunter record. The response's shape is part of its validity: `data` must be a
 *  plain object (the documented no-result state carries domain: null and emails: [] EXPLICITLY — an
 *  empty data object or a missing emails field is a malformed response, never an empty success). The
 *  domain field must be present: a string equal to the requested domain, or null (the documented
 *  no-result state). A response about a different domain is never attributed to the requested subject. */
function parseHunterRecord(body: string, domain: string): HunterData {
  const parsed = parseJson(body, "Hunter domain search") as { data?: HunterData };
  if (parsed.data === undefined || parsed.data === null || typeof parsed.data !== "object" || Array.isArray(parsed.data)) {
    throw new Error("TR-051: Hunter domain search returned a malformed response (no data object)");
  }
  const data = parsed.data;
  if (data.domain === undefined) {
    throw new Error("TR-051: Hunter domain search returned a malformed response (no domain field)");
  }
  if (!Array.isArray(data.emails)) {
    throw new Error("TR-051: Hunter domain search returned a malformed response (no emails array)");
  }
  if (data.domain !== null && data.domain !== domain) {
    throw new Error(`TR-051: Hunter domain search returned a different domain (${data.domain}) than requested (${domain})`);
  }
  return data;
}

export const hunterDomainEmails = defineTransform<Tr051Input>(
  {
    id: "TR-051",
    version: "1.0.0",
    inputs: ["domain"],
    outputs: ["email", "domain"],
    network: { mode: "pinned", allow: ["api.hunter.io"] },
    secrets: ["HUNTER_KEY"],
    limits: { rps: 1, timeoutMs: 15_000, maxBytes: 1_000_000 },
    sensitivity: "natural_person_gate",
    license: "LC-C",
    // P4-002: the documented Admiralty source grade (D2/5.13) — the basis the confidence model consumes.
    admiralty: {
      reliability: "D",
      credibility: 4,
      rationale: "Hunter.io يكتشف إيميلات منشورة تجميعياً — التغطية انتقائية والبيانات قديمة نسبياً بطبيعتها",
    },
  },
  async (input, ctx) => {
    if (input.domain === undefined || input.domain === null) throw new Error("TR-051: domain is required");
    const domain = normalizeDomain(input.domain);
    if (domain === "" || !domain.includes(".")) throw new Error(`TR-051: "${input.domain}" is not a registrable domain`);
    const res = await ctx.http.get(`${HUNTER_DOMAIN_SEARCH}?domain=${encodeURIComponent(domain)}`);
    expectStatus(res, [200], "Hunter domain search");
    const data = parseHunterRecord(res.body, domain);
    // The source's no-result state (data.domain null, empty emails) is a real negative: an empty
    // finding set, not an error — the coverage map records it as "none".
    const findings = emailFindings(data, res.requestId);
    const pattern = data.pattern !== null && data.pattern !== undefined ? patternFinding(domain, data.pattern, res.requestId) : undefined;
    if (pattern !== undefined) findings.push(pattern);
    return { findings };
  },
);
