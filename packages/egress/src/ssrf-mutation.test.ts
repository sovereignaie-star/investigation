/**
 * Negative controls for the SSRF matrix (P2-003): each check in the gateway is removed in a throw-away copy of
 * the source, and the cases about that check must then FAIL. A case that still passes with its check removed is
 * not evidence for that check.
 *
 * The copies live in a temp dir outside the repo and are deleted afterwards. Every mutation is an exact text
 * replacement; if the anchor text disappears from the real source the test fails loudly (so a refactor cannot
 * silently turn a control into a no-op).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { executeCase, mismatches, SSRF_CASES, type Factory } from "./ssrf-cases";
import { TIMING_CASES } from "./ssrf-timing-cases";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE_IDENTIFIERS = path.resolve(HERE, "../../core/src/identifiers/index.ts");
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "egress-mutants-"));
afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

interface Mutation {
  readonly name: string;
  readonly file: "egress.ts" | "address-policy.ts" | "content-inventory.ts" | "byte-budget.ts";
  readonly from: string;
  readonly to: string;
  /** Further replacements in the same file, for checks that are deliberately layered (defence in depth). */
  readonly also?: ReadonlyArray<readonly [string, string]>;
  /** Case ids that must detect the mutation (at least one case of each id must mismatch). */
  readonly detectedBy: readonly string[];
}

const MUTATIONS: readonly Mutation[] = [
  {
    name: "no scheme check",
    file: "egress.ts",
    from: 'if (url.protocol !== "https:") return deny("scheme");',
    to: "",
    // 001 is no longer a detector: http://127.0.0.1 is recorded as address_class before the scheme check
    detectedBy: ["T-SEC-SSRF-012", "T-SEC-SSRF-020"],
  },
  {
    name: "no port check",
    file: "egress.ts",
    from: 'if (url.port !== "" && url.port !== "443") return deny("port");',
    to: "",
    detectedBy: ["T-SEC-SSRF-020", "T-SEC-SSRF-039"],
  },
  {
    name: "no userinfo check",
    file: "egress.ts",
    from: 'if (url.username || url.password) return deny("credentials");',
    to: "",
    detectedBy: ["T-SEC-SSRF-019", "T-SEC-SSRF-039"],
  },
  {
    name: "literal address not classified",
    file: "egress.ts",
    from: "if (!literal.verdict.ok) {",
    to: "if (false) {",
    also: [["if (literal !== null && !literal.verdict.ok) {", "if (false) {"]],
    detectedBy: [
      "T-SEC-SSRF-001",
      "T-SEC-SSRF-003",
      "T-SEC-SSRF-005",
      "T-SEC-SSRF-007",
      "T-SEC-SSRF-008",
      "T-SEC-SSRF-009",
      "T-SEC-SSRF-035",
      "T-SEC-SSRF-036",
      "T-SEC-SSRF-037",
      "T-SEC-SSRF-038",
    ],
  },
  {
    name: "literal address class no longer precedes the scheme check",
    file: "egress.ts",
    from: "const shape = literalHostCheck(currentUrl) ?? urlChecks(currentUrl);",
    to: "const shape = urlChecks(currentUrl);",
    detectedBy: ["T-SEC-SSRF-001"],
  },
  {
    name: "protected category no longer precedes the request contract",
    file: "egress.ts",
    from: "const protectedRefusal = protectedCategory(req);",
    to: "const protectedRefusal = null as EgressResult | null;",
    detectedBy: ["T-SEC-SSRF-040"],
  },
  {
    name: "request content not inspected (sends taken on trust)",
    file: "egress.ts",
    from: "const contentErr = checkContent(req, postPolicies);",
    to: "const contentErr = null as EgressResult | null;",
    detectedBy: ["T-SEC-SSRF-043"],
  },
  {
    name: "a context keyword alone makes an ordinary reading refuse (evidence criterion removed)",
    file: "content-inventory.ts",
    from: ".filter(isStrongReading)",
    to: "",
    detectedBy: ["T-SEC-SSRF-043"],
  },
  {
    name: "natural-person readings held to the ordinary evidence bar (context no longer counts)",
    file: "content-inventory.ts",
    from: 'return c.sensitivity === "natural_person_gate" || c.validated',
    to: "return c.validated",
    detectedBy: ["T-SEC-SSRF-043"],
  },
  {
    name: "resolved addresses not classified",
    file: "egress.ts",
    from: "if (!lit.verdict.ok) return deny(",
    to: "if (false) return deny(",
    detectedBy: ["T-SEC-SSRF-002", "T-SEC-SSRF-004", "T-SEC-SSRF-010", "T-SEC-SSRF-014", "T-SEC-SSRF-015"],
  },
  {
    name: "only the first resolved address is classified",
    file: "egress.ts",
    from: "for (const ip of resolved) {",
    to: "for (const ip of resolved.slice(0, 1)) {",
    detectedBy: ["T-SEC-SSRF-014"],
  },
  {
    name: "allow list not applied to the request host",
    file: "egress.ts",
    from: "if (!allowedSet.has(targetHost) || !allowedSet.has(pinTarget)) {",
    to: "if (false) {",
    detectedBy: ["T-SEC-SSRF-016", "T-SEC-SSRF-017", "T-SEC-SSRF-018", "T-SEC-SSRF-044"],
  },
  {
    name: "empty allow list treated as public",
    file: "egress.ts",
    from: "opts.allowedHosts === undefined ? undefined",
    to: "opts.allowedHosts === undefined || opts.allowedHosts.length === 0 ? undefined",
    detectedBy: ["T-SEC-SSRF-016"],
  },
  {
    name: "allow list not applied to redirects",
    file: "egress.ts",
    from: "if (!allowedSet.has(normalizeHost(nextHost))) {",
    to: "if (false) {",
    detectedBy: ["T-SEC-SSRF-011"],
  },
  {
    name: "pinned host not applied to redirects",
    file: "egress.ts",
    from: 'if (normalizedPin === "" || normalizeHost(nextHost) !== normalizedPin) {',
    to: "if (false) {",
    detectedBy: ["T-SEC-SSRF-041"],
  },
  {
    name: "host normalisation without IDNA",
    file: "egress.ts",
    from: 'const ascii = domainToASCII(bare.replace(/\\.$/, ""));',
    to: 'const ascii = bare.replace(/\\.$/, "");',
    detectedBy: ["T-SEC-SSRF-018"],
  },
  {
    name: "host normalisation keeps the trailing dot",
    file: "egress.ts",
    from: 'return ascii.replace(/\\.$/, "").toLowerCase();',
    to: "return host.trim().toLowerCase();",
    detectedBy: ["T-SEC-SSRF-044"],
  },
  {
    name: "no redirect limit",
    file: "egress.ts",
    from: "if (hopCount > limits.maxRedirects) return refuse(",
    to: "if (false) return refuse(",
    detectedBy: ["T-SEC-SSRF-013"],
  },
  {
    name: "no header CR/LF check",
    file: "egress.ts",
    from: 'if (/[\\r\\n]/.test(v)) return deny("header"',
    to: 'if (false) return deny("header"',
    detectedBy: ["T-SEC-SSRF-021"],
  },
  {
    name: "no size check",
    file: "egress.ts",
    from: "if (declared > limits.maxSizeBytes || actual > limits.maxSizeBytes) {",
    to: "if (false) {",
    detectedBy: ["T-SEC-SSRF-022"],
  },
  { name: "no rate limit", file: "egress.ts", from: "if (b.tokens < 1) return false;", to: "", detectedBy: ["T-SEC-SSRF-024"] },
  {
    name: "redirect hops not rate limited",
    file: "egress.ts",
    from: "if (!redirectLimiter.take(nextHostForAudit)) {",
    to: "if (false) {",
    detectedBy: ["T-SEC-SSRF-024"],
  },
  {
    name: "no case check",
    file: "egress.ts",
    from: 'if (!req.systemContext && !req.caseId) return deny("no_case");',
    to: "",
    detectedBy: ["T-SEC-SSRF-027"],
  },
  {
    name: "natural person allowed (both layers: the early protected-category check and the sensitivity check)",
    file: "egress.ts",
    from: 'if (sensitivity === "natural_person_gate") return deny("natural_person");',
    to: "",
    also: [['if ((req as { sensitivity?: unknown }).sensitivity !== "natural_person_gate") return null;', "return null;"]],
    detectedBy: ["T-SEC-SSRF-028", "T-SEC-SSRF-040"],
  },
  {
    name: "missing sensitivity allowed",
    file: "egress.ts",
    from: 'if (sensitivity === undefined) return deny("unclassified_data", 0, "sensitivity is required");',
    to: "if (sensitivity === undefined) return null;",
    detectedBy: ["T-SEC-SSRF-028"],
  },
  {
    name: "IR_OFFLINE env ignored",
    file: "egress.ts",
    from: 'opts.offline === true || process.env["IR_OFFLINE"] === "1"',
    to: "opts.offline === true",
    detectedBy: ["T-SEC-SSRF-029"],
  },
  {
    name: "secret allowed in public mode",
    file: "egress.ts",
    from: 'if (!req.pinnedHost) return deny("secret_host_mismatch", 0, "a secret requires pinnedHost");',
    to: "",
    detectedBy: ["T-SEC-SSRF-041"],
  },
  {
    name: "provider registry not checked",
    file: "egress.ts",
    from: "const registryErr = checkSecretRegistry(req, opts);",
    to: "const registryErr = null as EgressResult | null;",
    detectedBy: ["T-SEC-SSRF-041"],
  },
  {
    name: "secret allowed in URL",
    file: "egress.ts",
    from: 'if (secretInUrl(req.url, req.secret)) return deny("credentials"',
    to: 'if (false) return deny("credentials"',
    detectedBy: ["T-SEC-SSRF-041"],
  },
  {
    name: "undeclared data allowed",
    file: "egress.ts",
    from: 'if (!PUBLIC_ALLOWED_SENDS.has(kind) && !PERSON_SUBJECT_SENDS.has(kind)) return deny("undeclared_data");',
    to: "",
    detectedBy: ["T-SEC-SSRF-043"],
  },
  {
    name: "unknown fields accepted",
    file: "egress.ts",
    from: 'if (!REQUEST_FIELDS.has(k)) return deny("unknown_field"',
    to: 'if (false) return deny("unknown_field"',
    detectedBy: ["T-SEC-SSRF-042"],
  },
  {
    name: "IPv4-mapped verdict ignored",
    file: "address-policy.ts",
    from: "return { ok: v4.ok, kind: v4.kind, reason: `embedded IPv4: ${v4.reason}` };",
    to: 'return { ok: true, kind: "public", reason: "mutant" };',
    detectedBy: ["T-SEC-SSRF-003"],
  },
  {
    name: "NAT64 embedded verdict ignored",
    file: "address-policy.ts",
    from: "return { ok: v4.ok, kind: v4.kind, reason: `NAT64 embedded IPv4: ${v4.reason}` };",
    to: 'return { ok: true, kind: "public", reason: "mutant" };',
    detectedBy: ["T-SEC-SSRF-009", "T-SEC-SSRF-037"],
  },
  { name: "6to4 rule removed", file: "address-policy.ts", from: '["2002::/16", "tunnel"],', to: "", detectedBy: ["T-SEC-SSRF-035"] },
  {
    name: "Teredo rule removed (and the 2001::/23 fallback that also covers it)",
    file: "address-policy.ts",
    from: '["2001::/32", "tunnel"],',
    to: "",
    also: [['["2001::/23", "reserved"],', ""]],
    detectedBy: ["T-SEC-SSRF-036"],
  },
  {
    name: "NAT64-local refusal removed (early return, table row and the outside-2000::/3 default: three layers)",
    file: "address-policy.ts",
    from: 'return { ok: false, kind: "nat_local", reason: "NAT64 local (RFC 8215) — unverifiable destination" };',
    to: "",
    also: [
      ['["64:ff9b:1::/48", "nat_local"],', ""],
      ["if ((b[0] & 0xe0) === 0x20) return", "if (true) return"],
    ],
    detectedBy: ["T-SEC-SSRF-037"],
  },
  {
    name: "2000::/3 default widened to everything",
    file: "address-policy.ts",
    from: "if ((b[0] & 0xe0) === 0x20) return",
    to: "if (true) return",
    detectedBy: ["T-SEC-SSRF-038"],
  },
  // P2-032: redirect content policy (ADR-08 section 4)
  {
    name: "redirect content verdict not applied",
    file: "egress.ts",
    from: "if (contentVerdict) return refuse(",
    to: "if (false as boolean) return refuse(",
    detectedBy: ["T-SEC-SSRF-043"],
  },
  {
    name: "no natural-person check on a redirect target",
    file: "content-inventory.ts",
    from: 'if (np) return { reason: "natural_person", detail: `redirect target',
    to: 'if (false as boolean) return { reason: "natural_person", detail: `redirect target',
    detectedBy: ["T-SEC-SSRF-043"],
  },
  {
    name: "no undeclared-data check on a cross-host redirect",
    file: "content-inventory.ts",
    from: "if (undeclared) return { reason: undeclared.reason",
    to: "if (false as boolean) return { reason: undeclared!.reason",
    detectedBy: ["T-SEC-SSRF-043"],
  },
  {
    name: "undeclared-data check only on cross-host redirect hops (the pre-P2-039 rule)",
    file: "content-inventory.ts",
    from: "const undeclared = undeclaredIn(findings, sends);",
    to: "const undeclared = crossHost ? undeclaredIn(findings, sends) : null;",
    detectedBy: ["T-SEC-SSRF-043"],
  },
  {
    name: "fixed-path exemption matches a path prefix",
    file: "content-inventory.ts",
    from: "return staticPaths.includes(`${host}${url.pathname}`) ||",
    to: "return staticPaths.some((e) => `${host}${url.pathname}`.startsWith(e)) ||",
    detectedBy: ["T-SEC-SSRF-043"],
  },
  {
    name: "fixed-path exemption covers every surface, not only the path",
    file: "content-inventory.ts",
    from: 'if (fixedPath && surface === "path" &&',
    to: "if (fixedPath &&",
    detectedBy: ["T-SEC-SSRF-043"],
  },
  {
    name: "no sent-value check on a cross-host redirect",
    file: "content-inventory.ts",
    from: "if (texts.some((t) => t.includes(v))) {",
    to: "if (false as boolean) {",
    detectedBy: ["T-SEC-SSRF-043"],
  },
  {
    name: "every redirect treated as same-host",
    file: "egress.ts",
    from: "normalizeHost(nextHost) !== first.firstHost",
    to: "false",
    detectedBy: ["T-SEC-SSRF-043"],
  },
  {
    name: "transform headers re-sent to a cross-host hop",
    file: "egress.ts",
    from: "hopHeaders = normalizeHost(currentUrl.hostname) === firstHost ? req.headers : crossHostHeaders(req.headers);",
    to: "hopHeaders = req.headers;",
    detectedBy: ["T-SEC-SSRF-043"],
  },
  {
    name: "no safe list on a cross-host hop",
    file: "content-inventory.ts",
    from: "if (!CROSS_HOST_SAFE_HEADERS.has(name.toLowerCase())) continue;",
    to: "",
    detectedBy: ["T-SEC-SSRF-043"],
  },
  {
    name: "safe-listed header values not inspected",
    file: "content-inventory.ts",
    from: "if (extract(value).length > 0) continue;",
    to: "",
    detectedBy: ["T-SEC-SSRF-043"],
  },
  {
    name: "headers dropped on every hop (over-refusal is also a regression)",
    file: "egress.ts",
    from: "hopHeaders = normalizeHost(currentUrl.hostname) === firstHost ? req.headers : crossHostHeaders(req.headers);",
    to: "hopHeaders = crossHostHeaders(req.headers);",
    detectedBy: ["T-SEC-SSRF-043"],
  },
];

/** Mutations of the time limits, detected by the fake-clock cases in `ssrf-timing-cases.ts` (023, 034). */
const TIMING_MUTATIONS: readonly Mutation[] = [
  {
    name: "no total deadline (the request deadline is pushed 1000x out)",
    file: "egress.ts",
    from: "const deadline = now() + limits.timeoutMs;",
    to: "const deadline = now() + limits.timeoutMs * 1000;",
    detectedBy: ["T-SEC-SSRF-023"],
  },
  {
    name: "no connect timeout (a hop may run until the total deadline)",
    file: "egress.ts",
    from: "const hopDeadline = Math.min(deadline, now() + limits.connectTimeoutMs);",
    to: "const hopDeadline = deadline;",
    detectedBy: ["T-SEC-SSRF-034"],
  },
];

async function loadMutant(m: Mutation | null): Promise<Factory> {
  const dir = fs.mkdtempSync(path.join(ROOT, "m-"));
  // P2-026: path-template.ts is part of the copied set — the gateway's path-template check
  // imports it, and the mutation harness must copy every file egress.ts imports.
  for (const f of ["egress.ts", "address-policy.ts", "content-inventory.ts", "byte-budget.ts", "post-policy.ts", "path-template.ts"]) {
    let src = fs.readFileSync(path.join(HERE, f), "utf8");
    if (m && m.file === f) {
      expect(src.includes(m.from), `mutation anchor for "${m.name}" not found in ${f}`).toBe(true);
      for (const [from, to] of [[m.from, m.to] as const, ...(m.also ?? [])]) {
        expect(src.includes(from), `mutation anchor for "${m.name}" not found in ${f}: ${from}`).toBe(true);
        src = src.split(from).join(to);
      }
    }
    // the copies live outside the workspace: point the @ir/core import at its source file
    src = src.split('from "@ir/core/identifiers"').join(`from ${JSON.stringify(CORE_IDENTIFIERS)}`);
    fs.writeFileSync(path.join(dir, f), src);
  }
  const mod = (await import(/* @vite-ignore */ path.join(dir, "egress.ts"))) as { createEgressGateway: Factory };
  return mod.createEgressGateway;
}

describe("SSRF matrix negative controls (mutation)", () => {
  it("sanity: an unmodified copy passes every case (the harness itself is not what fails)", async () => {
    const factory = await loadMutant(null);
    for (const c of SSRF_CASES) {
      expect(mismatches(c, await executeCase(factory, c)), `${c.id} ${c.title}`).toEqual([]);
    }
  });

  it("sanity: an unmodified copy passes every time-based case", async () => {
    const factory = await loadMutant(null);
    for (const c of TIMING_CASES) expect(await c.run(factory), `${c.id} ${c.title}`).toEqual([]);
  });

  for (const m of TIMING_MUTATIONS) {
    it(`"${m.name}" is detected by ${m.detectedBy.join(", ")}`, async () => {
      const factory = await loadMutant(m);
      for (const id of m.detectedBy) {
        const cases = TIMING_CASES.filter((c) => c.id === id);
        expect(cases.length, `no time-based cases for ${id}`).toBeGreaterThan(0);
        let detected = 0;
        for (const c of cases) if ((await c.run(factory)).length > 0) detected++;
        expect(detected, `${id} did not detect "${m.name}"`).toBeGreaterThan(0);
      }
    });
  }

  for (const m of MUTATIONS) {
    it(`"${m.name}" is detected by ${m.detectedBy.join(", ")}`, async () => {
      const factory = await loadMutant(m);
      for (const id of m.detectedBy) {
        const cases = SSRF_CASES.filter((c) => c.id === id);
        expect(cases.length, `no cases for ${id}`).toBeGreaterThan(0);
        let detected = 0;
        for (const c of cases) if (mismatches(c, await executeCase(factory, c)).length > 0) detected++;
        expect(detected, `${id} did not detect "${m.name}"`).toBeGreaterThan(0);
      }
    });
  }
});
