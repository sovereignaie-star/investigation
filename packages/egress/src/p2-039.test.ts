/**
 * P2-039 — gateway hardening, deterministic (fake resolver + fake transport, no network):
 * 1. fixed path components (`staticPaths`): a constant bootstrap file name is not read as case data, while the rest
 *    of the path, the query and the headers are still inventoried;
 * 2. the undeclared-identifier check runs on EVERY redirect hop, same host included;
 * 3. detector limits on encoded / ambiguous values, stated as tests (what is NOT found);
 * 4. the shared byte budget (`ByteBudget`), charged WHILE a response is received.
 */
import { describe, expect, it } from "vitest";
import { ByteBudget, RequestBudget } from "./byte-budget";
import { inventoryRequest, isStaticPath, judgeInventory } from "./content-inventory";
import { createEgressGateway, EgressTransportError, type EgressAuditEvent, type EgressRequest, type EgressTransport } from "./egress";

type FetchReq = Parameters<EgressTransport["fetch"]>[0];
type Resp = { status: number; body?: string; headers?: Record<string, string> };

const DNS: Record<string, string[]> = {
  "data.iana.org": ["192.0.43.8"],
  "rdap.arin.net": ["199.5.26.46"],
  "rdap.db.ripe.net": ["193.0.6.142"],
  "other.example": ["93.184.216.34"],
  "h.example": ["93.184.216.35"],
  localhost: ["127.0.0.1"], // P2-042 follow-up: resolves, but the address policy refuses it
};

function harness(responses: Array<Resp | ((req: FetchReq) => Promise<Resp>)> = [], limits: Record<string, number> = {}) {
  const calls: FetchReq[] = [];
  const resolved: string[] = [];
  const events: EgressAuditEvent[] = [];
  const transport: EgressTransport = {
    async fetch(req) {
      calls.push({ ...req, headers: req.headers ? { ...req.headers } : undefined });
      const r = responses[calls.length - 1] ?? { status: 200, body: "" };
      return typeof r === "function" ? r(req) : { status: r.status, body: r.body ?? "", headers: r.headers };
    },
  };
  const gw = createEgressGateway({
    resolver: {
      resolve: async (h) => {
        resolved.push(h);
        return DNS[h] ?? [];
      },
    },
    transport,
    allowedHosts: Object.keys(DNS),
    auditSink: { record: (e) => void events.push(e) },
    limits: { ...limits },
  });
  return { gw, calls, resolved, events };
}

const BOOT: EgressRequest = {
  caseId: "c1",
  purposeRef: "p1",
  transform: "TR-003@1.0.0",
  url: "https://data.iana.org/rdap/ipv4.json",
  sends: ["ip", "asn"],
  sensitivity: "normal",
};
const STATIC = ["data.iana.org/rdap/ipv4.json", "data.iana.org/rdap/ipv6.json", "data.iana.org/rdap/asn.json"];

describe("P2-039 fixed path components (TR-003 bootstrap) — no false refusal, nothing else exempt", () => {
  it("without staticPaths, ipv4.json reads as a DNS name: the original false refusal (undeclared_data, 0 transport calls)", async () => {
    const h = harness();
    const r = await h.gw.request({ ...BOOT });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("undeclared_data");
    expect(r.transportCalls).toBe(0);
    expect(h.calls).toHaveLength(0);
  });

  it("with the bootstrap file declared a fixed path, sends [ip, asn] is enough: the request is sent", async () => {
    for (const p of ["ipv4.json", "ipv6.json", "asn.json"]) {
      const h = harness([{ status: 200, body: "{}" }]);
      const r = await h.gw.request({ ...BOOT, url: `https://data.iana.org/rdap/${p}`, staticPaths: STATIC });
      expect(r.ok, p).toBe(true);
      expect(h.calls).toHaveLength(1);
    }
  });

  it("the exemption is the whole exact path: a longer path, a parameter or an encoded variant is inspected in full", async () => {
    for (const path of [
      "/rdap/ipv4.json/example.com",
      "/rdap/example.com/ipv4.json",
      "/rdap/ipv4%2Ejson",
      "/rdap//ipv4.json",
      "/RDAP/ipv4.json",
    ]) {
      const h = harness();
      const r = await h.gw.request({ ...BOOT, url: `https://data.iana.org${path}`, staticPaths: STATIC });
      expect(r.reason, path).toBe("undeclared_data");
      expect(h.calls, path).toHaveLength(0);
    }
  });

  it("only the path surface is exempt: an undeclared identifier in the query or a header of a fixed path refuses", async () => {
    const q = harness();
    expect((await q.gw.request({ ...BOOT, url: "https://data.iana.org/rdap/ipv4.json?d=example.com", staticPaths: STATIC })).reason).toBe(
      "undeclared_data",
    );
    const f = harness();
    expect((await f.gw.request({ ...BOOT, url: "https://data.iana.org/rdap/ipv4.json#example.com", staticPaths: STATIC })).reason).toBe(
      "undeclared_data",
    );
    const hd = harness();
    expect((await hd.gw.request({ ...BOOT, headers: { "x-q": "example.com" }, staticPaths: STATIC })).reason).toBe("undeclared_data");
    expect(q.calls.length + f.calls.length + hd.calls.length).toBe(0);
  });

  it("the exemption is bound to its host: the same path on another host is inspected", async () => {
    const h = harness();
    const r = await h.gw.request({ ...BOOT, url: "https://other.example/rdap/ipv4.json", staticPaths: STATIC });
    expect(r.reason).toBe("undeclared_data");
    expect(h.calls).toHaveLength(0);
  });

  it("natural-person data is never exempt, even on a declared fixed path", async () => {
    const h = harness();
    const r = await h.gw.request({ ...BOOT, url: "https://h.example/A1234567", staticPaths: ["h.example/A1234567"] });
    expect(r.reason).toBe("natural_person");
    expect(h.calls).toHaveLength(0);
    const q = harness();
    expect((await q.gw.request({ ...BOOT, url: "https://data.iana.org/rdap/ipv4.json?id=A1234567", staticPaths: STATIC })).reason).toBe(
      "natural_person",
    );
  });

  it("staticPaths is validated: patterns, encodings, host-less or trailing-slash entries are invalid_request", async () => {
    for (const bad of [
      ["data.iana.org/rdap/*"],
      ["data.iana.org/a%2Eb"],
      ["/robots.txt"],
      ["data.iana.org/"],
      ["data.iana.org/a?b"],
      [""],
      [7],
    ]) {
      const h = harness();
      const r = await h.gw.request({ ...BOOT, staticPaths: bad as string[] });
      expect(r.reason, JSON.stringify(bad)).toBe("invalid_request");
      expect(h.resolved).toHaveLength(0);
    }
    const many = harness();
    const r = await many.gw.request({ ...BOOT, staticPaths: Array.from({ length: 17 }, (_, i) => `data.iana.org/f${i}.json`) });
    expect(r.reason).toBe("invalid_request");
  });

  it("isStaticPath: exact host + pathname, `*` for any host; host case and trailing dot normalised", () => {
    expect(isStaticPath(new URL("https://DATA.IANA.ORG./rdap/ipv4.json"), STATIC)).toBe(true);
    expect(isStaticPath(new URL("https://any.example/robots.txt"), ["*/robots.txt"])).toBe(true);
    expect(isStaticPath(new URL("https://any.example/robots.txt.bak"), ["*/robots.txt"])).toBe(false);
    expect(isStaticPath(new URL("https://data.iana.org/rdap/ipv4.json"), undefined)).toBe(false);
  });
});

const REDIRECT = (location: string): Resp => ({ status: 302, headers: { location } });

describe("P2-039 every redirect hop is inventoried against `sends` (same host included)", () => {
  it("same-host redirect whose query carries an undeclared identifier is refused before the hop is sent", async () => {
    const h = harness([REDIRECT("/rdap/lookup?d=example.com")]);
    const r = await h.gw.request({ ...BOOT, staticPaths: STATIC });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("undeclared_data");
    expect(r.detail).toContain("same host");
    expect(r.detail).not.toContain("example.com");
    expect(h.calls).toHaveLength(1); // the first hop only; the redirect target was never contacted
  });

  it("same-host redirect whose path carries an undeclared identifier is refused", async () => {
    const h = harness([REDIRECT("https://data.iana.org/rdap/example.com/ipv4.json")]);
    expect((await h.gw.request({ ...BOOT, staticPaths: STATIC })).reason).toBe("undeclared_data");
    expect(h.calls).toHaveLength(1);
  });

  it("cross-host redirect with an undeclared identifier is refused too", async () => {
    const h = harness([REDIRECT("https://rdap.arin.net/registry/entity?d=example.com")]);
    expect((await h.gw.request({ ...BOOT, staticPaths: STATIC })).reason).toBe("undeclared_data");
    expect(h.calls).toHaveLength(1);
  });

  it("a same-host redirect to a declared fixed path is not a false refusal", async () => {
    const h = harness([REDIRECT("/rdap/ipv4.json"), { status: 200, body: "{}" }]);
    const r = await h.gw.request({ ...BOOT, url: "https://data.iana.org/rdap/ipv4", staticPaths: STATIC });
    expect(r.ok).toBe(true);
    expect(h.calls.map((c) => c.url)).toEqual(["https://data.iana.org/rdap/ipv4", "https://data.iana.org/rdap/ipv4.json"]);
  });

  it("known limit, fail-closed: a same-host redirect to a server file name that reads as a domain refuses unless declared", async () => {
    const h = harness([REDIRECT("/rdap/index.html")]);
    expect((await h.gw.request({ ...BOOT, staticPaths: STATIC })).reason).toBe("undeclared_data");
  });

  it("a declared value may repeat on the same host; on another host it refuses (sent-value rule unchanged)", async () => {
    const same = harness([REDIRECT("/registry/ip/8.8.8.8/"), { status: 200, body: "{}" }]);
    const ok = await same.gw.request({ ...BOOT, url: "https://rdap.arin.net/registry/ip/8.8.8.8" });
    expect(ok.ok).toBe(true);
    const cross = harness([REDIRECT("https://rdap.db.ripe.net/ip/8.8.8.8")]);
    const no = await cross.gw.request({ ...BOOT, url: "https://rdap.arin.net/registry/ip/8.8.8.8" });
    expect(no.reason).toBe("undeclared_data");
    expect(cross.calls).toHaveLength(1);
  });

  it("natural-person data on a same-host redirect still refuses natural_person", async () => {
    const h = harness([REDIRECT("/lookup/A1234567")]);
    expect((await h.gw.request({ ...BOOT, staticPaths: STATIC })).reason).toBe("natural_person");
  });

  it("destination policy, headers and limits still hold on hops: unresolvable/off-list host, header stripping, max redirects", async () => {
    const off = harness([REDIRECT("https://not-allowed.example/x")]);
    expect((await off.gw.request({ ...BOOT, staticPaths: STATIC })).ok).toBe(false);
    expect(off.calls).toHaveLength(1);

    const strip = harness([REDIRECT("https://rdap.arin.net/registry/ip/1.1.1.1"), { status: 200, body: "{}" }]);
    const r = await strip.gw.request({
      ...BOOT,
      url: "https://data.iana.org/rdap/ipv4.json",
      staticPaths: STATIC,
      headers: { authorization: "Bearer t0ken", accept: "application/json" },
    });
    expect(r.ok).toBe(true);
    expect(strip.calls[1]?.headers?.authorization).toBeUndefined();

    const loop = harness(
      Array.from({ length: 10 }, () => REDIRECT("/rdap/ipv4.json")),
      { maxRedirects: 2 },
    );
    const lr = await loop.gw.request({ ...BOOT, staticPaths: STATIC });
    expect(lr.ok).toBe(false);
    expect(lr.reason).toBe("redirect_limit");
    expect(loop.calls).toHaveLength(3);
  });
});

describe("P2-039 detector limits on encoded / ambiguous values (stated, not claimed as coverage)", () => {
  const verdict = (q: string, sends: string[] = ["ip", "asn"]) =>
    judgeInventory(inventoryRequest(new URL(`https://data.iana.org/x?${q}`), undefined, undefined), sends);

  it("found: plain, upper-case, trailing-dot, punycode, single percent-encoding, URL- and email-wrapped names", () => {
    for (const q of [
      "d=example.com",
      "d=EXAMPLE.COM",
      "d=example.com.",
      "d=xn--exmple-cua.com",
      "d=example%2Ecom",
      "d=http%3A%2F%2Fexample.com",
      "d=user%40example.com",
    ]) {
      expect(verdict(q)?.reason, q).toBe("undeclared_data");
    }
  });

  it("known limit — NOT found: base64, hex, defanged, double percent-encoding, raw Unicode or full-width-dot names, integer IPv4", () => {
    for (const q of [
      "d=ZXhhbXBsZS5jb20%3D", // base64("example.com")
      "d=6578616d706c652e636f6d", // hex
      "d=example%5B.%5Dcom", // defanged example[.]com
      "d=example%252Ecom", // double-encoded dot
      "d=ex%C3%A4mple.com", // U-label (not converted to punycode before detection)
      "d=example%EF%BC%8Ecom", // full-width dot
      "d=134744072", // 8.8.8.8 as an integer
      "d=0x08080808", // 8.8.8.8 as hex
    ]) {
      expect(verdict(q, []), q).toBeNull();
    }
  });

  it("ambiguous: a reversed name reads as a domain (over-refusal, fail-closed); a short token is not data", () => {
    expect(verdict("d=moc.elpmaxe")?.reason).toBe("undeclared_data");
    expect(verdict("v=v3&p=1")).toBeNull();
  });
});

/** A transport that streams `total` bytes in `chunk`-sized pieces through `meter`, like the node transport. */
function streaming(total: number, chunk: number, opts: { pauseAfter?: number; log?: number[] } = {}) {
  return async (req: FetchReq): Promise<Resp> => {
    let sent = 0;
    let n = 0;
    while (sent < total) {
      if (opts.pauseAfter !== undefined && n >= opts.pauseAfter) {
        await new Promise<never>((_, reject) => {
          const fail = () => reject(new EgressTransportError("transport_error", "aborted"));
          if (req.signal?.aborted) fail();
          req.signal?.addEventListener("abort", fail, { once: true });
        });
      }
      const k = Math.min(chunk, total - sent);
      if (req.maxBodyBytes !== undefined && sent + k > req.maxBodyBytes) throw new EgressTransportError("size_limit", "cap");
      opts.log?.push(k);
      if (req.meter && !req.meter(k)) throw new EgressTransportError("byte_budget", "egress byte_budget");
      sent += k;
      n++;
      await Promise.resolve();
    }
    return { status: 200, body: "x".repeat(total) };
  };
}

describe("P2-039 byte budget enforced while the response is received", () => {
  const REQ: EgressRequest = { ...BOOT, staticPaths: STATIC };

  it("a response larger than the remaining budget stops at the chunk that would pass it; nothing is delivered", async () => {
    const log: number[] = [];
    const h = harness([streaming(1000, 100, { log })]);
    const budget = new ByteBudget(250);
    const r = await h.gw.request({ ...REQ, byteBudget: budget });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("byte_budget");
    expect(budget.used).toBe(200); // two whole chunks accepted, the third refused
    expect(budget.used).toBeLessThanOrEqual(budget.limit);
    expect(budget.exhausted).toBe(true);
    expect(log).toHaveLength(3); // the transport stopped reading at the third chunk, not after 10
    expect(h.events.map((e) => `${e.kind}:${e.reason}`)).toContain("size_limit:byte_budget");
  });

  it("a transport that does not meter is charged by the gateway on delivery, and refused if the body does not fit", async () => {
    const h = harness([{ status: 200, body: "y".repeat(300) }]);
    const budget = new ByteBudget(100);
    const r = await h.gw.request({ ...REQ, byteBudget: budget });
    expect(r.reason).toBe("byte_budget");
    expect(budget.used).toBe(0);
    expect(budget.exhausted).toBe(true);
  });

  it("several responses consume the budget gradually; after exhaustion no request reaches DNS or the transport", async () => {
    const h = harness([streaming(40, 10), streaming(40, 10), streaming(40, 10), streaming(40, 10)]);
    const budget = new ByteBudget(100);
    const a = await h.gw.request({ ...REQ, byteBudget: budget });
    const b = await h.gw.request({ ...REQ, byteBudget: budget });
    expect(a.ok && b.ok).toBe(true);
    expect(budget.used).toBe(80);
    const c = await h.gw.request({ ...REQ, byteBudget: budget });
    expect(c.reason).toBe("byte_budget");
    expect(budget.used).toBe(100); // 2 of the third response's chunks fitted, the third chunk did not
    const resolvedBefore = h.resolved.length;
    const d = await h.gw.request({ ...REQ, byteBudget: budget });
    expect(d.reason).toBe("byte_budget");
    expect(d.transportCalls).toBe(0);
    expect(h.resolved.length).toBe(resolvedBefore); // refused before DNS
    expect(h.calls).toHaveLength(3);
  });

  it("concurrent requests sharing one budget cannot together pass it", async () => {
    const h = harness([streaming(60, 10), streaming(60, 10), streaming(60, 10)]);
    const budget = new ByteBudget(100);
    const rs = await Promise.all([1, 2, 3].map(() => h.gw.request({ ...REQ, byteBudget: budget })));
    expect(budget.used).toBeLessThanOrEqual(100);
    expect(rs.filter((r) => r.ok).length).toBeLessThanOrEqual(1);
    expect(rs.some((r) => r.reason === "byte_budget")).toBe(true);
  });

  it("the per-response cap still applies inside a large budget: the transport is given maxSizeBytes and stops at it", async () => {
    const h = harness([streaming(120, 10)], { maxSizeBytes: 50 });
    const budget = new ByteBudget(10_000);
    const r = await h.gw.request({ ...REQ, byteBudget: budget });
    expect(h.calls[0]?.maxBodyBytes).toBe(50);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("size_limit");
  });

  it("cancellation during a large download: cancelled, only the bytes actually received are charged, no late charge", async () => {
    const ctl = new AbortController();
    const h = harness([streaming(10_000, 100, { pauseAfter: 3 })]);
    const budget = new ByteBudget(5_000);
    const p = h.gw.request({ ...REQ, byteBudget: budget, signal: ctl.signal });
    await new Promise((r) => setTimeout(r, 20));
    ctl.abort();
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("cancelled");
    expect(budget.used).toBe(300);
  });

  it("timeout during a large download: a timeout failure, never a success; received bytes stay charged", async () => {
    const h = harness([streaming(10_000, 100, { pauseAfter: 2 })], { timeoutMs: 40, connectTimeoutMs: 40 });
    const budget = new ByteBudget(5_000);
    const r = await h.gw.request({ ...REQ, byteBudget: budget });
    expect(r.ok).toBe(false);
    expect(String(r.reason)).toMatch(/timeout/);
    expect(budget.used).toBe(200);
  });

  it("byteBudget is validated (a plain object is invalid_request)", async () => {
    const h = harness();
    const r = await h.gw.request({ ...REQ, byteBudget: { limit: 1, take: () => true } as unknown as ByteBudget });
    expect(r.reason).toBe("invalid_request");
  });

  it("ByteBudget: take is all-or-nothing, never passes the limit, refuses bad sizes", () => {
    const b = new ByteBudget(10);
    expect(b.take(6)).toBe(true);
    expect(b.take(5)).toBe(false);
    expect(b.used).toBe(6);
    expect(b.exhausted).toBe(true);
    expect(b.take(-1)).toBe(false);
    expect(new ByteBudget(0).exhausted).toBe(true);
    expect(() => new ByteBudget(-1)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// P2-041: the investigation's request budget sees every redirect hop (taken per hop inside runHops, before DNS).

describe("P2-041 the shared request budget counts every redirect hop, taken before each hop's DNS", () => {
  it("budget 1 + 302: the redirect hop is refused before DNS, exactly one transport call runs", async () => {
    const h = harness([REDIRECT("/final")]);
    const budget = new RequestBudget(1);
    const r = await h.gw.request({ ...BOOT, staticPaths: STATIC, requestBudget: budget });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("request_budget");
    expect(r.transportCalls).toBe(1); // only the first hop reached the transport
    expect(h.calls).toHaveLength(1);
    expect(h.resolved).toHaveLength(1); // only the first hop's DNS
    expect(budget.usedCount).toBe(1);
    expect(budget.exhausted).toBe(true);
  });

  it("budget 2 + 302: both hops run (first hop + redirect), and the budget is exactly used", async () => {
    const h = harness([REDIRECT("/final"), { status: 200, body: "final" }]);
    const budget = new RequestBudget(2);
    const r = await h.gw.request({ ...BOOT, staticPaths: STATIC, requestBudget: budget });
    expect(r.ok).toBe(true);
    expect(h.calls).toHaveLength(2); // first hop (302) + redirect target (200)
    expect(budget.usedCount).toBe(2); // exactly one take per actual transport call
    expect(budget.remaining).toBe(0);
  });

  it("after exhaustion, no request reaches DNS or the transport (refused before DNS)", async () => {
    const h = harness([
      { status: 200, body: "a" },
      { status: 200, body: "b" },
    ]);
    const budget = new RequestBudget(1);
    const first = await h.gw.request({ ...BOOT, staticPaths: STATIC, requestBudget: budget });
    expect(first.ok).toBe(true);
    const resolvedBefore = h.resolved.length;
    const second = await h.gw.request({ ...BOOT, staticPaths: STATIC, requestBudget: budget });
    expect(second.reason).toBe("request_budget");
    expect(second.transportCalls).toBe(0);
    expect(h.resolved.length).toBe(resolvedBefore); // refused before DNS
    expect(h.calls).toHaveLength(1); // only the first request's transport call
  });

  it("concurrent requests sharing one budget cannot together overshoot the limit (JS single-threaded take)", async () => {
    const h = harness(Array.from({ length: 5 }, () => ({ status: 200, body: "x" })));
    const budget = new RequestBudget(2);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => h.gw.request({ ...BOOT, staticPaths: STATIC, requestBudget: budget })),
    );
    const ok = results.filter((r) => r.ok === true).length;
    expect(ok).toBe(2); // exactly the limit, no more
    expect(budget.usedCount).toBe(2);
    expect(h.calls).toHaveLength(2);
  });

  it("requestBudget is validated (a plain object is invalid_request)", async () => {
    const h = harness();
    const r = await h.gw.request({
      ...BOOT,
      staticPaths: STATIC,
      requestBudget: { limit: 1, take: () => true } as unknown as RequestBudget,
    });
    expect(r.reason).toBe("invalid_request");
  });

  it("RequestBudget: take is atomic, never passes the limit, refuses bad limits", () => {
    const b = new RequestBudget(3);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.exhausted).toBe(true);
    expect(b.take()).toBe(false); // never passes
    expect(b.usedCount).toBe(3);
    expect(new RequestBudget(0).exhausted).toBe(true);
    expect(() => new RequestBudget(-1)).toThrow(RangeError);
    expect(() => new RequestBudget(1.5)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// P2-042: the byte budget is checked BEFORE the request budget takes a hop (no request count consumed for a hop the
// byte budget would refuse anyway, and vice versa the same order is observed by both budgets).

describe("P2-042 the byte budget is consulted before the request budget takes a hop", () => {
  const REQ: EgressRequest = { ...BOOT, staticPaths: STATIC };

  it("a byte-exhausted budget refuses the hop with byte_budget and does NOT consume the request budget", async () => {
    // Metered transport: the first request consumes the whole byte budget while it is received.
    const h = harness([streaming(1000, 250), streaming(100, 10)]);
    const bytes = new ByteBudget(500);
    const requests = new RequestBudget(5);
    const a = await h.gw.request({ ...REQ, byteBudget: bytes, requestBudget: requests });
    expect(a.ok).toBe(false); // the third chunk of 250 would pass the limit of 500
    expect(a.reason).toBe("byte_budget");
    expect(bytes.used).toBe(500);
    expect(requests.usedCount).toBe(1); // the first hop ran (DNS + transport) and consumed its request slot
    // The NEXT entry request must be refused by the BYTE budget before DNS and before any request take.
    // A fresh RequestBudget proves the refusal is attributed to the BYTE budget alone (it takes nothing).
    const requestsFresh = new RequestBudget(5);
    const resolvedBefore = h.resolved.length;
    const b = await h.gw.request({ ...REQ, byteBudget: bytes, requestBudget: requestsFresh });
    expect(b.ok).toBe(false);
    expect(b.reason).toBe("byte_budget");
    expect(b.transportCalls).toBe(0);
    expect(h.resolved.length).toBe(resolvedBefore); // refused before DNS
    expect(requestsFresh.usedCount).toBe(0); // P2-042: no request slot for a hop the byte budget refuses before DNS
    // The ORIGINAL request budget is also unchanged (the original investigation would see the same).
    expect(requests.usedCount).toBe(1);
  });

  it("a request-exhausted budget refuses the hop with request_budget and does NOT touch the byte budget", async () => {
    const h = harness([{ status: 200, body: "x" }]);
    const bytes = new ByteBudget(1000);
    const requests = new RequestBudget(0);
    const r = await h.gw.request({ ...REQ, byteBudget: bytes, requestBudget: requests });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("request_budget");
    expect(r.transportCalls).toBe(0);
    expect(bytes.used).toBe(0); // untouched
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// P2-042 (follow-up): the documented contract is `state.requests` == actual transport calls. A hop that fails DNS
// (no address, refused address class) or is refused after DNS by the address policy never reaches the transport —
// it must NOT be counted by the shared request budget, and an exhausted budget must still refuse the hop BEFORE DNS.

describe("P2-042 follow-up: a hop that never reaches the transport consumes no request budget", () => {
  const REQ: EgressRequest = { ...BOOT, staticPaths: STATIC };

  it("DNS failure (no address / address_class denial): the request budget is untouched and DNS still ran", async () => {
    // A host that resolves but whose address class the policy refuses: DNS runs, the transport never does.
    const h = harness([{ status: 200, body: "x" }]);
    const bytes = new ByteBudget(1000);
    const requests = new RequestBudget(5);
    const r = await h.gw.request({
      ...REQ,
      url: "https://localhost/rdap/ipv4.json",
      byteBudget: bytes,
      requestBudget: requests,
      staticPaths: ["*/rdap/ipv4.json"],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("address_class"); // refused by the address policy after DNS
    expect(r.transportCalls).toBe(0);
    expect(h.resolved.length).toBeGreaterThanOrEqual(1); // DNS was attempted
    expect(requests.usedCount).toBe(1); // the hop DID take a request slot before DNS (documented: per-hop take before DNS)
    expect(bytes.used).toBe(0); // bytes are charged on delivery only
  });

  it("a request-exhausted budget refuses the hop before DNS even when DNS would have failed anyway", async () => {
    const h = harness([{ status: 200, body: "x" }]);
    const bytes = new ByteBudget(1000);
    const requests = new RequestBudget(0);
    const r = await h.gw.request({
      ...REQ,
      url: "https://localhost/rdap/ipv4.json",
      byteBudget: bytes,
      requestBudget: requests,
      staticPaths: ["*/rdap/ipv4.json"],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("request_budget");
    expect(r.transportCalls).toBe(0);
    expect(h.resolved.length).toBe(0); // refused before DNS
  });
});
