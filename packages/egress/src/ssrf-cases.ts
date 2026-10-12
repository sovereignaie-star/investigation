/**
 * Canonical SSRF case table (P2-003, ROADMAP 8.3.1) for the gateway-level cases.
 *
 * Every entry is executed by `ssrf-matrix.test.ts` against the real `createEgressGateway`, and by
 * `ssrf-mutation.test.ts` against deliberately weakened copies of the gateway (negative controls): a case that
 * still "passes" when the check it is about has been removed would prove nothing.
 *
 * Every case asserts the decision, the reason, the number of transport calls, the number of DNS calls and (where
 * the transport is reached) the actual destination host + pinned IP handed to the transport.
 *
 * Cases that need a real socket (025, 026, 031, 032, 033 and the bomb half of 022) live in
 * `node-transport-ssrf.test.ts`; time and cancellation cases (023, 034) and the redaction / capability cases
 * (030, 042) need custom drivers and live in `ssrf-matrix.test.ts` directly.
 *
 * TEST-ONLY module: it is not exported from `index.ts` and contains no network code.
 */
import {
  EGRESS_DENY_CODE,
  type EgressOptions,
  type EgressReason,
  type EgressRequest,
  type EgressResult,
  type createEgressGateway,
} from "./egress";

export type Factory = typeof createEgressGateway;

export type FakeResponse = { status: number; headers?: Record<string, string>; body?: string; contentLength?: number } | { throw: string };

export interface SsrfCase {
  readonly id: string;
  readonly title: string;
  readonly req?: Partial<EgressRequest>;
  /** host -> addresses; an array of arrays is a per-call sequence (rebinding). */
  readonly dns?: Readonly<Record<string, readonly string[] | readonly (readonly string[])[]>>;
  readonly responses?: readonly FakeResponse[];
  readonly options?: Partial<Pick<EgressOptions, "allowedHosts" | "offline" | "providerHosts" | "limits">>;
  /** Earlier requests sent through the same gateway before the observed one (rate limit). */
  readonly before?: readonly Partial<EgressRequest>[];
  /** Environment variables set for the duration of the case. */
  readonly env?: Readonly<Record<string, string>>;
  readonly expect: {
    readonly ok: boolean;
    readonly reason?: EgressReason;
    readonly transportCalls: number;
    readonly resolverCalls?: number;
    readonly destinations?: ReadonlyArray<{ host: string; pinnedIp: string }>;
  };
}

export interface Observed {
  readonly result: EgressResult;
  readonly transportCalls: number;
  readonly resolverCalls: number;
  readonly destinations: Array<{ host: string; pinnedIp: string }>;
}

export const BASE_REQUEST: EgressRequest = {
  caseId: "case-ssrf",
  purposeRef: "purpose-ssrf",
  transform: "ssrf.matrix@1",
  url: "https://example.com/",
  method: "GET",
  sends: ["domain"],
  sensitivity: "normal",
};

const PUB = "93.184.216.34";
const PUB2 = "93.184.216.35";

export async function executeCase(factory: Factory, c: SsrfCase): Promise<Observed> {
  const destinations: Array<{ host: string; pinnedIp: string }> = [];
  let resolverCalls = 0;
  const perHostCalls = new Map<string, number>();
  let responseIndex = 0;
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(c.env ?? {})) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    const g = factory({
      ...(c.options ?? {}),
      resolver: {
        resolve: async (host: string) => {
          resolverCalls++;
          const entry = c.dns?.[host];
          if (!entry) return [];
          if (entry.length > 0 && Array.isArray(entry[0])) {
            const seq = entry as readonly (readonly string[])[];
            const n = perHostCalls.get(host) ?? 0;
            perHostCalls.set(host, n + 1);
            return [...(seq[Math.min(n, seq.length - 1)] ?? [])];
          }
          return [...(entry as readonly string[])];
        },
      },
      transport: {
        fetch: async (r) => {
          destinations.push({ host: r.host, pinnedIp: r.pinnedIp });
          const resp = c.responses?.[responseIndex++] ?? { status: 200, body: "ok" };
          if ("throw" in resp) throw new Error(resp.throw);
          return { ...resp };
        },
      },
    });
    for (const b of c.before ?? []) await g.request({ ...BASE_REQUEST, ...b } as EgressRequest);
    const before = destinations.length;
    const beforeResolver = resolverCalls;
    const result = await g.request({ ...BASE_REQUEST, ...(c.req ?? {}) } as EgressRequest);
    return {
      result,
      transportCalls: destinations.length - before,
      resolverCalls: resolverCalls - beforeResolver,
      destinations: destinations.slice(before),
    };
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) Reflect.deleteProperty(process.env, k);
      else process.env[k] = v;
    }
  }
}

/** Does the observation match the case's expectation? Returns the list of mismatches (empty = match). */
/** P2-003 acceptance: a refusal proves its code and reason; an acceptance names its destinations and pinned IPs. */
function evidenceGaps(c: SsrfCase, o: Observed): string[] {
  const e = c.expect;
  if (e.ok) return e.destinations === undefined ? ["an acceptance case must name its destinations and pinned IPs"] : [];
  const out: string[] = [];
  if (o.result.code !== EGRESS_DENY_CODE) out.push(`code: expected ${EGRESS_DENY_CODE}, got ${String(o.result.code)}`);
  if (e.reason === undefined) out.push("a refusal case must name its reason");
  return out;
}

export function mismatches(c: SsrfCase, o: Observed): string[] {
  const out: string[] = [];
  const e = c.expect;
  if (o.result.ok !== e.ok) out.push(`ok: expected ${e.ok}, got ${o.result.ok} (${o.result.reason ?? "-"})`);
  out.push(...evidenceGaps(c, o));
  if (e.reason !== undefined && o.result.reason !== e.reason) out.push(`reason: expected ${e.reason}, got ${o.result.reason ?? "-"}`);
  if (o.transportCalls !== e.transportCalls) out.push(`transport calls: expected ${e.transportCalls}, got ${o.transportCalls}`);
  if (o.result.transportCalls !== e.transportCalls) {
    out.push(`result.transportCalls: expected ${e.transportCalls}, got ${o.result.transportCalls}`);
  }
  if (e.resolverCalls !== undefined && o.resolverCalls !== e.resolverCalls) {
    out.push(`resolver calls: expected ${e.resolverCalls}, got ${o.resolverCalls}`);
  }
  if (e.destinations !== undefined && JSON.stringify(o.destinations) !== JSON.stringify(e.destinations)) {
    out.push(`destinations: expected ${JSON.stringify(e.destinations)}, got ${JSON.stringify(o.destinations)}`);
  }
  return out;
}

const denied = (reason: EgressReason, transportCalls = 0, resolverCalls?: number): SsrfCase["expect"] =>
  resolverCalls === undefined ? { ok: false, reason, transportCalls } : { ok: false, reason, transportCalls, resolverCalls };
const redirectTo = (location: string, status = 302): FakeResponse => ({ status, headers: { location } });

export const SSRF_CASES: readonly SsrfCase[] = [
  // 001 — loopback literal
  {
    id: "T-SEC-SSRF-001",
    title: "http://127.0.0.1 is recorded as address_class (literal address precedes the scheme check)",
    req: { url: "http://127.0.0.1/" },
    expect: denied("address_class", 0, 0),
  },
  { id: "T-SEC-SSRF-001", title: "https://127.0.0.1", req: { url: "https://127.0.0.1/" }, expect: denied("address_class", 0, 0) },
  // 002 — localhost names
  {
    id: "T-SEC-SSRF-002",
    title: "https://localhost resolving to 127.0.0.1",
    req: { url: "https://localhost/" },
    dns: { localhost: ["127.0.0.1"] },
    expect: denied("address_class", 0, 1),
  },
  {
    id: "T-SEC-SSRF-002",
    title: "a name resolving to 127.0.0.2",
    req: { url: "https://loop.example/" },
    dns: { "loop.example": ["127.0.0.2"] },
    expect: denied("address_class", 0, 1),
  },
  // 003 — IPv6 loopback and IPv4-mapped
  { id: "T-SEC-SSRF-003", title: "[::1]", req: { url: "https://[::1]/" }, expect: denied("address_class", 0, 0) },
  {
    id: "T-SEC-SSRF-003",
    title: "[::ffff:127.0.0.1] (URL-normalised to [::ffff:7f00:1])",
    req: { url: "https://[::ffff:127.0.0.1]/" },
    expect: denied("address_class", 0, 0),
  },
  {
    id: "T-SEC-SSRF-003",
    title: "[::ffff:169.254.169.254]",
    req: { url: "https://[::ffff:169.254.169.254]/" },
    expect: denied("address_class", 0, 0),
  },
  {
    id: "T-SEC-SSRF-003",
    title: "control: [::ffff:93.184.216.34] (mapped public) is allowed",
    req: { url: "https://[::ffff:93.184.216.34]/" },
    expect: { ok: true, transportCalls: 1, resolverCalls: 0, destinations: [{ host: "::ffff:5db8:d822", pinnedIp: "::ffff:5db8:d822" }] },
  },
  // 004 — metadata via DNS
  {
    id: "T-SEC-SSRF-004",
    title: "a name resolving to 169.254.169.254",
    req: { url: "https://meta.example/" },
    dns: { "meta.example": ["169.254.169.254"] },
    expect: denied("address_class", 0, 1),
  },
  {
    id: "T-SEC-SSRF-004",
    title: "control: the same name resolving to a public address is allowed",
    req: { url: "https://meta.example/" },
    dns: { "meta.example": [PUB] },
    expect: { ok: true, transportCalls: 1, resolverCalls: 1, destinations: [{ host: "meta.example", pinnedIp: PUB }] },
  },
  // 005 — RFC 1918
  ...["10.0.0.1", "172.16.0.1", "192.168.1.1"].map((ip) => ({
    id: "T-SEC-SSRF-005",
    title: `literal ${ip}`,
    req: { url: `https://${ip}/` },
    expect: denied("address_class", 0, 0),
  })),
  ...["10.0.0.1", "172.16.0.1", "192.168.1.1"].map((ip) => ({
    id: "T-SEC-SSRF-005",
    title: `a name resolving to ${ip}`,
    req: { url: "https://intranet.example/" },
    dns: { "intranet.example": [ip] },
    expect: denied("address_class", 0, 1),
  })),
  // 006 — CGNAT, unspecified, broadcast, multicast
  ...["100.64.0.1", "0.0.0.0", "255.255.255.255", "224.0.0.1"].map((ip) => ({
    id: "T-SEC-SSRF-006",
    title: `literal ${ip}`,
    req: { url: `https://${ip}/` },
    expect: denied("address_class", 0, 0),
  })),
  // 007 — alternative IPv4 spellings (decision after URL normalisation)
  ...["2130706433", "0x7f000001", "0177.0.0.1", "127.1", "0x7f.0.0.1"].map((h) => ({
    id: "T-SEC-SSRF-007",
    title: `https://${h}/ (normalised to 127.0.0.1)`,
    req: { url: `https://${h}/` },
    expect: denied("address_class", 0, 0),
  })),
  // 008 — IPv6 ULA, link-local, multicast
  ...["fd00::1", "fe80::1", "ff02::1"].map((ip) => ({
    id: "T-SEC-SSRF-008",
    title: `[${ip}]`,
    req: { url: `https://[${ip}]/` },
    expect: denied("address_class", 0, 0),
  })),
  {
    id: "T-SEC-SSRF-008",
    title: "a name with an AAAA in fd00::/8",
    req: { url: "https://ula.example/" },
    dns: { "ula.example": ["fd00::1"] },
    expect: denied("address_class", 0, 1),
  },
  // 009 — NAT64 metadata
  {
    id: "T-SEC-SSRF-009",
    title: "[64:ff9b::a9fe:a9fe] (NAT64 of 169.254.169.254)",
    req: { url: "https://[64:ff9b::a9fe:a9fe]/" },
    expect: denied("address_class", 0, 0),
  },
  // 010 — redirect to internal targets
  ...["https://10.0.0.1/", "https://169.254.169.254/latest/meta-data/", "https://[::ffff:127.0.0.1]/"].map((loc) => ({
    id: "T-SEC-SSRF-010",
    title: `302 to ${loc}`,
    req: { url: "https://example.com/" },
    dns: { "example.com": [PUB] },
    responses: [redirectTo(loc)],
    expect: { ...denied("address_class", 1, 1), destinations: [{ host: "example.com", pinnedIp: PUB }] },
  })),
  {
    id: "T-SEC-SSRF-010",
    title: "302 to a name that resolves to 169.254.169.254 (re-resolved per hop)",
    req: { url: "https://example.com/" },
    dns: { "example.com": [PUB], "meta.example": ["169.254.169.254"] },
    responses: [redirectTo("https://meta.example/")],
    expect: denied("address_class", 1, 2),
  },
  // 011 — redirect host policy
  {
    id: "T-SEC-SSRF-011",
    title: "pinned mode: redirect to a host outside the list",
    options: { allowedHosts: ["a.example"] },
    req: { url: "https://a.example/" },
    dns: { "a.example": [PUB], "b.example": [PUB2] },
    responses: [redirectTo("https://b.example/")],
    expect: denied("host_not_allowed", 1, 1),
  },
  {
    id: "T-SEC-SSRF-011",
    title: "public mode: redirect to another public host is re-checked and allowed",
    req: { url: "https://a.example/" },
    dns: { "a.example": [PUB], "b.example": [PUB2] },
    responses: [redirectTo("https://b.example/x"), { status: 200, body: "b" }],
    expect: {
      ok: true,
      transportCalls: 2,
      resolverCalls: 2,
      destinations: [
        { host: "a.example", pinnedIp: PUB },
        { host: "b.example", pinnedIp: PUB2 },
      ],
    },
  },
  // 012 — downgrade
  {
    id: "T-SEC-SSRF-012",
    title: "redirect https -> http",
    req: { url: "https://example.com/" },
    dns: { "example.com": [PUB] },
    responses: [redirectTo("http://example.com/")],
    expect: denied("scheme", 1, 1),
  },
  // 013 — redirect limit
  {
    id: "T-SEC-SSRF-013",
    title: "4 redirects (> 3)",
    req: { url: "https://example.com/0" },
    dns: { "example.com": [PUB] },
    responses: [1, 2, 3, 4].map((i) => redirectTo(`https://example.com/${i}`)),
    expect: denied("redirect_limit", 4, 4),
  },
  {
    id: "T-SEC-SSRF-013",
    title: "control: exactly 3 redirects are followed",
    req: { url: "https://example.com/0" },
    dns: { "example.com": [PUB] },
    responses: [...[1, 2, 3].map((i) => redirectTo(`https://example.com/${i}`)), { status: 200, body: "end" }],
    expect: {
      ok: true,
      transportCalls: 4,
      resolverCalls: 4,
      destinations: [
        { host: "example.com", pinnedIp: PUB },
        { host: "example.com", pinnedIp: PUB },
        { host: "example.com", pinnedIp: PUB },
        { host: "example.com", pinnedIp: PUB },
      ],
    },
  },
  // 014 — mixed answers
  {
    id: "T-SEC-SSRF-014",
    title: "A public + A private",
    req: { url: "https://mixed.example/" },
    dns: { "mixed.example": [PUB, "10.0.0.1"] },
    expect: denied("address_class", 0, 1),
  },
  {
    id: "T-SEC-SSRF-014",
    title: "A public + AAAA private (fd00::1)",
    req: { url: "https://mixed.example/" },
    dns: { "mixed.example": [PUB, "fd00::1"] },
    expect: denied("address_class", 0, 1),
  },
  {
    id: "T-SEC-SSRF-014",
    title: "private first, public second",
    req: { url: "https://mixed.example/" },
    dns: { "mixed.example": ["127.0.0.1", PUB] },
    expect: denied("address_class", 0, 1),
  },
  // 015 — rebinding
  {
    id: "T-SEC-SSRF-015",
    title: "rebinding: the transport gets the address that was checked, DNS is asked once per hop",
    req: { url: "https://rebind.example/" },
    dns: { "rebind.example": [[PUB], ["127.0.0.1"]] },
    expect: { ok: true, transportCalls: 1, resolverCalls: 1, destinations: [{ host: "rebind.example", pinnedIp: PUB }] },
  },
  {
    id: "T-SEC-SSRF-015",
    title: "rebinding on a same-host redirect: the second resolution is checked again and refused",
    req: { url: "https://rebind.example/" },
    dns: { "rebind.example": [[PUB], ["127.0.0.1"]] },
    responses: [redirectTo("https://rebind.example/again")],
    expect: denied("address_class", 1, 2),
  },
  // 016 — public vs pinned new host
  {
    id: "T-SEC-SSRF-016",
    title: "public mode: a new public host is allowed (and audited)",
    req: { url: "https://new-host.example/" },
    dns: { "new-host.example": [PUB] },
    expect: { ok: true, transportCalls: 1, resolverCalls: 1, destinations: [{ host: "new-host.example", pinnedIp: PUB }] },
  },
  {
    id: "T-SEC-SSRF-016",
    title: "pinned mode: a host outside network.allow is refused before DNS",
    options: { allowedHosts: ["a.example"] },
    req: { url: "https://new-host.example/" },
    dns: { "new-host.example": [PUB] },
    expect: denied("host_not_allowed", 0, 0),
  },
  {
    id: "T-SEC-SSRF-016",
    title: "pinned mode: an EMPTY allow list denies everything (not 'public')",
    options: { allowedHosts: [] },
    req: { url: "https://new-host.example/" },
    dns: { "new-host.example": [PUB] },
    expect: denied("host_not_allowed", 0, 0),
  },
  // 017 — partial matches
  ...["evil-allowed.com", "allowed.com.evil.net", "sub.allowed.com", "allowed.co"].map((h) => ({
    id: "T-SEC-SSRF-017",
    title: `pinned allowed.com vs ${h}`,
    options: { allowedHosts: ["allowed.com"] },
    req: { url: `https://${h}/` },
    dns: { [h]: [PUB] },
    expect: denied("host_not_allowed", 0, 0),
  })),
  {
    id: "T-SEC-SSRF-017",
    title: "control: allowed.com itself is allowed",
    options: { allowedHosts: ["allowed.com"] },
    req: { url: "https://allowed.com/" },
    dns: { "allowed.com": [PUB] },
    expect: { ok: true, transportCalls: 1, resolverCalls: 1, destinations: [{ host: "allowed.com", pinnedIp: PUB }] },
  },
  // 018 — IDN / homoglyph / punycode
  {
    id: "T-SEC-SSRF-018",
    title: "Cyrillic homoglyph \u0430llowed.com (punycoded by the URL parser) does not match allowed.com",
    options: { allowedHosts: ["allowed.com"] },
    req: { url: "https://\u0430llowed.com/" },
    dns: { "xn--llowed-9nf.com": [PUB] },
    expect: denied("host_not_allowed", 0, 0),
  },
  {
    id: "T-SEC-SSRF-018",
    title: "the same homoglyph written as punycode does not match allowed.com",
    options: { allowedHosts: ["allowed.com"] },
    req: { url: "https://xn--llowed-9nf.com/" },
    dns: { "xn--llowed-9nf.com": [PUB] },
    expect: denied("host_not_allowed", 0, 0),
  },
  {
    id: "T-SEC-SSRF-018",
    title: "a homoglyph on the allow list does not let the Latin name through",
    options: { allowedHosts: ["\u0430llowed.com"] },
    req: { url: "https://allowed.com/" },
    dns: { "allowed.com": [PUB] },
    expect: denied("host_not_allowed", 0, 0),
  },
  {
    id: "T-SEC-SSRF-018",
    title: "control: an IDN listed in Unicode matches its punycode form (normalised both sides)",
    options: { allowedHosts: ["b\u00fccher.example"] },
    req: { url: "https://xn--bcher-kva.example/" },
    dns: { "xn--bcher-kva.example": [PUB] },
    expect: { ok: true, transportCalls: 1, resolverCalls: 1, destinations: [{ host: "xn--bcher-kva.example", pinnedIp: PUB }] },
  },
  {
    id: "T-SEC-SSRF-018",
    title: "control: an IDN listed in punycode matches the Unicode URL; the transport gets the ASCII name",
    options: { allowedHosts: ["xn--bcher-kva.example"] },
    req: { url: "https://B\u00dcCHER.example/" },
    dns: { "xn--bcher-kva.example": [PUB] },
    expect: { ok: true, transportCalls: 1, resolverCalls: 1, destinations: [{ host: "xn--bcher-kva.example", pinnedIp: PUB }] },
  },
  // 019 — userinfo
  {
    id: "T-SEC-SSRF-019",
    title: "user:pass@allowed.com",
    req: { url: "https://user:pass@allowed.com/" },
    dns: { "allowed.com": [PUB] },
    expect: denied("credentials", 0, 0),
  },
  {
    id: "T-SEC-SSRF-019",
    title: "user@allowed.com",
    req: { url: "https://user@allowed.com/" },
    dns: { "allowed.com": [PUB] },
    expect: denied("credentials", 0, 0),
  },
  // 020 — ports and schemes
  ...["https://example.com:8443/", "https://example.com:80/", "https://example.com:22/"].map((u) => ({
    id: "T-SEC-SSRF-020",
    title: u,
    req: { url: u },
    dns: { "example.com": [PUB] },
    expect: denied("port", 0, 0),
  })),
  ...["file:///etc/passwd", "ftp://example.com/", "gopher://example.com/", "data:text/plain,hi", "http://example.com/"].map((u) => ({
    id: "T-SEC-SSRF-020",
    title: u,
    req: { url: u },
    dns: { "example.com": [PUB] },
    expect: denied("scheme", 0, 0),
  })),
  {
    id: "T-SEC-SSRF-020",
    title: "an IPv6 URL with a zone id is not a valid URL (refused as invalid_url)",
    req: { url: "https://[fe80::1%25eth0]/" },
    expect: denied("invalid_url", 0, 0),
  },
  {
    id: "T-SEC-SSRF-020",
    title: "control: an explicit :443 is allowed",
    req: { url: "https://example.com:443/" },
    dns: { "example.com": [PUB] },
    expect: { ok: true, transportCalls: 1, resolverCalls: 1, destinations: [{ host: "example.com", pinnedIp: PUB }] },
  },
  // 021 — header injection
  {
    id: "T-SEC-SSRF-021",
    title: "CRLF in a header value",
    req: { headers: { "x-a": "v\r\nHost: evil" } },
    dns: { "example.com": [PUB] },
    expect: denied("header", 0, 0),
  },
  {
    id: "T-SEC-SSRF-021",
    title: "LF in a header name",
    req: { headers: { "x-a\nb": "v" } },
    dns: { "example.com": [PUB] },
    expect: denied("header", 0, 0),
  },
  // 022 — declared size (the gzip bomb half is in node-transport-ssrf.test.ts)
  {
    id: "T-SEC-SSRF-022",
    title: "declared Content-Length over the cap",
    options: { limits: { maxSizeBytes: 1024 } },
    dns: { "example.com": [PUB] },
    responses: [{ status: 200, body: "x", contentLength: 4096 }],
    expect: denied("size_limit", 1, 1),
  },
  {
    id: "T-SEC-SSRF-022",
    title: "control: a body of exactly the cap passes",
    options: { limits: { maxSizeBytes: 1024 } },
    dns: { "example.com": [PUB] },
    responses: [{ status: 200, body: "x".repeat(1024), contentLength: 1024 }],
    expect: { ok: true, transportCalls: 1, destinations: [{ host: "example.com", pinnedIp: PUB }] },
  },
  // 024 — rate limit
  {
    id: "T-SEC-SSRF-024",
    title: "third request inside the burst window for the same host",
    options: { limits: { rateLimitBurst: 2, rateLimitPerHostPerSecond: 1 } },
    before: [{}, {}],
    dns: { "example.com": [PUB] },
    expect: denied("rate_limit", 0, 0),
  },
  {
    id: "T-SEC-SSRF-024",
    title: "a redirect hop is charged to its own host's bucket",
    options: { limits: { rateLimitBurst: 1, rateLimitPerHostPerSecond: 1 } },
    before: [{ url: "https://b.example/" }],
    req: { url: "https://a.example/" },
    dns: { "a.example": [PUB], "b.example": [PUB2] },
    responses: [{ status: 200 }, redirectTo("https://b.example/")],
    expect: denied("rate_limit", 1, 1),
  },
  // 027 — case / purpose
  { id: "T-SEC-SSRF-027", title: "no caseId", req: { caseId: undefined }, dns: { "example.com": [PUB] }, expect: denied("no_case", 0, 0) },
  {
    id: "T-SEC-SSRF-027",
    title: "a case without a purpose",
    req: { purposeRef: undefined },
    dns: { "example.com": [PUB] },
    expect: denied("no_case", 0, 0),
  },
  // 028 — natural person
  {
    id: "T-SEC-SSRF-028",
    title: "sensitivity natural_person_gate",
    req: { sensitivity: "natural_person_gate" },
    dns: { "example.com": [PUB] },
    expect: denied("natural_person", 0, 0),
  },
  {
    id: "T-SEC-SSRF-028",
    title: "a missing sensitivity is never an implicit allow",
    req: { sensitivity: undefined },
    dns: { "example.com": [PUB] },
    expect: denied("unclassified_data", 0, 0),
  },
  // 029 — offline
  {
    id: "T-SEC-SSRF-029",
    title: "offline option",
    options: { offline: true },
    dns: { "example.com": [PUB] },
    expect: denied("offline", 0, 0),
  },
  {
    id: "T-SEC-SSRF-029",
    title: "IR_OFFLINE=1 in the environment, even with offline:false in the options",
    options: { offline: false },
    env: { IR_OFFLINE: "1" },
    dns: { "example.com": [PUB] },
    expect: denied("offline", 0, 0),
  },
  {
    id: "T-SEC-SSRF-029",
    title: "control: IR_OFFLINE=0 does not deny",
    env: { IR_OFFLINE: "0" },
    dns: { "example.com": [PUB] },
    expect: { ok: true, transportCalls: 1, resolverCalls: 1, destinations: [{ host: "example.com", pinnedIp: PUB }] },
  },
  // 035 — 6to4 (owner decision a: refuse all of 2002::/16)
  ...["2002:7f00:1::", "2002:5db8:d822::"].map((ip) => ({
    id: "T-SEC-SSRF-035",
    title: `[${ip}]`,
    req: { url: `https://[${ip}]/` },
    expect: denied("address_class", 0, 0),
  })),
  // 036 — Teredo and non-global 2001::/23
  ...["2001::1", "2001:2::1", "2001:10::1"].map((ip) => ({
    id: "T-SEC-SSRF-036",
    title: `[${ip}]`,
    req: { url: `https://[${ip}]/` },
    expect: denied("address_class", 0, 0),
  })),
  {
    id: "T-SEC-SSRF-036",
    title: "control: [2001:4:112::1] (globally reachable block) is allowed",
    req: { url: "https://[2001:4:112::1]/" },
    expect: { ok: true, transportCalls: 1, resolverCalls: 0, destinations: [{ host: "2001:4:112::1", pinnedIp: "2001:4:112::1" }] },
  },
  // 037 — NAT64
  {
    id: "T-SEC-SSRF-037",
    title: "control: [64:ff9b::808:808] (embedded public) is allowed",
    req: { url: "https://[64:ff9b::808:808]/" },
    expect: { ok: true, transportCalls: 1, resolverCalls: 0, destinations: [{ host: "64:ff9b::808:808", pinnedIp: "64:ff9b::808:808" }] },
  },
  ...["64:ff9b::a00:1", "64:ff9b::7f00:1", "64:ff9b:1::1"].map((ip) => ({
    id: "T-SEC-SSRF-037",
    title: `[${ip}]`,
    req: { url: `https://[${ip}]/` },
    expect: denied("address_class", 0, 0),
  })),
  // 038 — special IPv6 blocks
  ...["3fff::1", "5f00::1", "100:0:0:1::1", "2001:db8::1", "4000::1"].map((ip) => ({
    id: "T-SEC-SSRF-038",
    title: `[${ip}]`,
    req: { url: `https://[${ip}]/` },
    expect: denied("address_class", 0, 0),
  })),
  {
    id: "T-SEC-SSRF-038",
    title: "control: a public address inside 2000::/3 is allowed",
    req: { url: "https://[2606:4700::1111]/" },
    expect: { ok: true, transportCalls: 1, resolverCalls: 0, destinations: [{ host: "2606:4700::1111", pinnedIp: "2606:4700::1111" }] },
  },
  // 039 — redirect target shape
  {
    id: "T-SEC-SSRF-039",
    title: "redirect to :8443",
    req: { url: "https://example.com/" },
    dns: { "example.com": [PUB] },
    responses: [redirectTo("https://example.com:8443/")],
    expect: denied("port", 1, 1),
  },
  {
    id: "T-SEC-SSRF-039",
    title: "redirect to user@host",
    req: { url: "https://example.com/" },
    dns: { "example.com": [PUB] },
    responses: [redirectTo("https://user@example.com/")],
    expect: denied("credentials", 1, 1),
  },
  {
    id: "T-SEC-SSRF-039",
    title: "redirect to a non-public literal",
    req: { url: "https://example.com/" },
    dns: { "example.com": [PUB] },
    responses: [redirectTo("https://192.168.0.1/")],
    expect: denied("address_class", 1, 1),
  },
  // 040 — natural person cannot be switched off
  {
    id: "T-SEC-SSRF-040",
    title: "environment variables that look like overrides do not lift the natural-person refusal",
    env: { IR_ALLOW_NATURAL_PERSON: "1", IR_NATURAL_PERSON_POLICY: "adopted", P2_013_ADOPTED: "1", IR_OFFLINE: "0" },
    req: { sensitivity: "natural_person_gate" },
    dns: { "example.com": [PUB] },
    expect: denied("natural_person", 0, 0),
  },
  {
    id: "T-SEC-SSRF-040",
    title: "a request field claiming the policy is adopted is still recorded as natural_person (protected category first)",
    req: { sensitivity: "natural_person_gate", naturalPersonPolicyAdopted: true } as unknown as Partial<EgressRequest>,
    dns: { "example.com": [PUB] },
    expect: denied("natural_person", 0, 0),
  },
  // 042 (closed contract half): the gateway-level part of "any unknown field is refused"
  {
    id: "T-SEC-SSRF-042",
    title: "an unknown request field on a normal request is refused (closed contract) before DNS",
    req: { extra: 1 } as unknown as Partial<EgressRequest>,
    dns: { "example.com": [PUB] },
    expect: denied("unknown_field", 0, 0),
  },
  // 041 — secrets
  {
    id: "T-SEC-SSRF-041",
    title: "a secret in public mode (no pinnedHost)",
    req: { secret: "s3cr3t-value", secretProvider: "prov" },
    options: { providerHosts: { prov: ["example.com"] } },
    dns: { "example.com": [PUB] },
    expect: denied("secret_host_mismatch", 0, 0),
  },
  {
    id: "T-SEC-SSRF-041",
    title: "a secret pinned to a host outside its provider registry",
    req: { url: "https://other.example/", secret: "s3cr3t-value", secretProvider: "prov", pinnedHost: "other.example" },
    options: { providerHosts: { prov: ["example.com"] } },
    dns: { "other.example": [PUB] },
    expect: denied("secret_host_mismatch", 0, 0),
  },
  {
    id: "T-SEC-SSRF-041",
    title: "a secret for a provider that is not registered at all",
    req: { secret: "s3cr3t-value", secretProvider: "ghost", pinnedHost: "example.com" },
    options: { providerHosts: { prov: ["example.com"] } },
    dns: { "example.com": [PUB] },
    expect: denied("secret_host_mismatch", 0, 0),
  },
  {
    id: "T-SEC-SSRF-041",
    title: "a secret copied into the URL",
    req: { url: "https://example.com/?k=s3cr3t-value", secret: "s3cr3t-value", secretProvider: "prov", pinnedHost: "example.com" },
    options: { providerHosts: { prov: ["example.com"] } },
    dns: { "example.com": [PUB] },
    expect: denied("credentials", 0, 0),
  },
  {
    id: "T-SEC-SSRF-041",
    title: "pinned subdomain of the provider host is not the provider host (exact match)",
    req: { url: "https://api.example.com/", secret: "s3cr3t-value", secretProvider: "prov", pinnedHost: "example.com" },
    options: { providerHosts: { prov: ["example.com"] } },
    dns: { "api.example.com": [PUB] },
    expect: denied("host_not_allowed", 0, 0),
  },
  {
    id: "T-SEC-SSRF-041",
    title: "secret + redirect to another host is refused at the hop",
    req: { secret: "s3cr3t-value", secretProvider: "prov", pinnedHost: "example.com" },
    options: { providerHosts: { prov: ["example.com"] } },
    dns: { "example.com": [PUB], "evil.example": [PUB2] },
    responses: [redirectTo("https://evil.example/")],
    expect: denied("host_not_allowed", 1, 1),
  },
  {
    id: "T-SEC-SSRF-041",
    title: "control: secret to its registered provider host",
    req: { secret: "s3cr3t-value", secretProvider: "prov", pinnedHost: "example.com" },
    options: { providerHosts: { prov: ["example.com"] } },
    dns: { "example.com": [PUB] },
    expect: { ok: true, transportCalls: 1, resolverCalls: 1, destinations: [{ host: "example.com", pinnedIp: PUB }] },
  },
  // 043 — declared data
  {
    id: "T-SEC-SSRF-043",
    title: "a data kind outside the public set (email)",
    req: { sends: ["email"] },
    dns: { "example.com": [PUB] },
    expect: denied("undeclared_data", 0, 0),
  },
  {
    id: "T-SEC-SSRF-043",
    title: "no sends at all (manifest error, distinct from an empty list)",
    req: { sends: undefined },
    dns: { "example.com": [PUB] },
    expect: denied("missing_manifest", 0, 0),
  },
  {
    id: "T-SEC-SSRF-043",
    title: "control: an empty sends list is valid (no case data)",
    req: { sends: [] },
    dns: { "example.com": [PUB] },
    expect: { ok: true, transportCalls: 1, destinations: [{ host: "example.com", pinnedIp: PUB }] },
  },
  // 043 — content inspection: what the request carries must match `sends` (content-inventory.ts)
  {
    id: "T-SEC-SSRF-043",
    title: "content: an IP in the path while sends declares only domain is refused before DNS",
    req: { url: "https://example.com/lookup/8.8.8.8", sends: ["domain"] },
    dns: { "example.com": [PUB] },
    expect: denied("undeclared_data", 0, 0),
  },
  {
    id: "T-SEC-SSRF-043",
    title: "content: control: the same path with sends [ip] reaches the pinned address once",
    req: { url: "https://example.com/lookup/8.8.8.8", sends: ["ip"] },
    dns: { "example.com": [PUB] },
    expect: { ok: true, transportCalls: 1, resolverCalls: 1, destinations: [{ host: "example.com", pinnedIp: PUB }] },
  },
  {
    id: "T-SEC-SSRF-043",
    title: "content: an email address in a query value (percent-encoded) is refused as undeclared",
    req: { url: "https://example.com/search?q=alice%40example.org", sends: ["domain"] },
    dns: { "example.com": [PUB] },
    expect: denied("undeclared_data", 0, 0),
  },
  {
    id: "T-SEC-SSRF-043",
    title: "content: an email address in the fragment is refused as undeclared",
    req: { url: "https://example.com/#alice@example.org", sends: ["domain"] },
    dns: { "example.com": [PUB] },
    expect: denied("undeclared_data", 0, 0),
  },
  {
    id: "T-SEC-SSRF-043",
    title: "content: an email address in a header value is refused as undeclared",
    req: { headers: { "x-query": "alice@example.org" }, sends: ["domain"] },
    dns: { "example.com": [PUB] },
    expect: denied("undeclared_data", 0, 0),
  },
  {
    id: "T-SEC-SSRF-043",
    title: "content: a natural-person identifier (passport) in the path is refused as natural_person even when labelled normal",
    req: { url: "https://example.com/doc/A1234567", sends: ["domain"], sensitivity: "normal" },
    dns: { "example.com": [PUB] },
    expect: denied("natural_person", 0, 0),
  },
  {
    id: "T-SEC-SSRF-043",
    title: "content: declaring the kind does not lift a natural-person refusal (no downgrade by declaration)",
    req: { url: "https://example.com/doc/A1234567", sends: ["domain", "ip", "asn", "hash", "url", "certificate"] },
    dns: { "example.com": [PUB] },
    expect: denied("natural_person", 0, 0),
  },
  {
    id: "T-SEC-SSRF-043",
    title: "content: there is no body channel; a body field is an unknown field, refused before DNS",
    req: { body: "alice@example.org" } as unknown as Partial<EgressRequest>,
    dns: { "example.com": [PUB] },
    expect: denied("unknown_field", 0, 0),
  },
  {
    id: "T-SEC-SSRF-043",
    title: "content: control: ordinary path words and numeric query values are not data (no false refusal)",
    req: { url: "https://example.com/api/v3/items?page=2&limit=10", sends: [] },
    dns: { "example.com": [PUB] },
    expect: { ok: true, transportCalls: 1, resolverCalls: 1, destinations: [{ host: "example.com", pinnedIp: PUB }] },
  },
  // 044 — normalisation of the pinned list
  {
    id: "T-SEC-SSRF-044",
    title: "Allowed.COM. normalises to allowed.com and is allowed",
    options: { allowedHosts: ["allowed.com"] },
    req: { url: "https://Allowed.COM./" },
    dns: { "allowed.com.": [PUB] },
    expect: { ok: true, transportCalls: 1, resolverCalls: 1, destinations: [{ host: "allowed.com.", pinnedIp: PUB }] }, // the allow list compares the normalised name; the transport keeps the URL host
  },
  {
    id: "T-SEC-SSRF-044",
    title: "allowed.com.evil is refused",
    options: { allowedHosts: ["allowed.com"] },
    req: { url: "https://allowed.com.evil/" },
    dns: { "allowed.com.evil": [PUB] },
    expect: denied("host_not_allowed", 0, 0),
  },
  {
    id: "T-SEC-SSRF-044",
    title: "a list entry with a wildcard never matches",
    options: { allowedHosts: ["*.allowed.com"] },
    req: { url: "https://a.allowed.com/" },
    dns: { "a.allowed.com": [PUB] },
    expect: denied("host_not_allowed", 0, 0),
  },
];
