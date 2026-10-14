/** RFC 9309 robots.txt parsing and matching (ADR-08 section 6, decision C). Deterministic, no network. */
import { describe, expect, it } from "vitest";
import { parseRobots, robotsFromStatus } from "./robots.ts";

describe("parseRobots (RFC 9309)", () => {
  it("uses the * group when no group names our token", () => {
    const p = parseRobots("User-agent: *\nDisallow: /private\n");
    expect(p.isAllowed("/")).toBe(true);
    expect(p.isAllowed("/private")).toBe(false);
    expect(p.isAllowed("/private/x")).toBe(false);
    expect(p.isAllowed("/privatex")).toBe(false); // prefix match
    expect(p.isAllowed("/public")).toBe(true);
  });

  it("a group naming our product token (case-insensitive, exact) replaces the * group", () => {
    const txt = "User-agent: *\nDisallow: /\n\nUser-agent: investigationroom\nDisallow: /admin\n";
    const p = parseRobots(txt);
    expect(p.isAllowed("/")).toBe(true);
    expect(p.isAllowed("/admin")).toBe(false);
    // a substring of our token is NOT our token
    expect(parseRobots("User-agent: invest\nDisallow: /\n").isAllowed("/")).toBe(true);
    // the full UA product also addresses us
    expect(parseRobots("User-agent: InvestigationRoom-egress/1\nDisallow: /\n").isAllowed("/")).toBe(false);
  });

  it("an own group without rules allows everything even when * disallows", () => {
    expect(parseRobots("User-agent: *\nDisallow: /\nUser-agent: InvestigationRoom\n").isAllowed("/a")).toBe(true);
  });

  it("consecutive user-agent lines share one group; a rule line ends the agent list", () => {
    const txt = "User-agent: a\nUser-agent: InvestigationRoom\nDisallow: /x\nUser-agent: b\nDisallow: /y\n";
    const p = parseRobots(txt);
    expect(p.isAllowed("/x")).toBe(false);
    expect(p.isAllowed("/y")).toBe(true);
  });

  it("longest match wins; allow wins a tie; empty disallow is no rule", () => {
    const p = parseRobots("User-agent: *\nDisallow: /a\nAllow: /a/b\nDisallow: /a/b/c\nAllow: /t\nDisallow: /t\nDisallow:\n");
    expect(p.isAllowed("/a")).toBe(false);
    expect(p.isAllowed("/a/b")).toBe(true);
    expect(p.isAllowed("/a/b/c")).toBe(false);
    expect(p.isAllowed("/t")).toBe(true);
    expect(parseRobots("User-agent: *\nDisallow:\n").isAllowed("/anything")).toBe(true);
  });

  it("* and $ wildcards, with the query", () => {
    const p = parseRobots("User-agent: *\nDisallow: /*.pdf$\nDisallow: /search*q=\nAllow: /exact$\nDisallow: /exact\n");
    expect(p.isAllowed("/doc/file.pdf")).toBe(false);
    expect(p.isAllowed("/doc/file.pdf?x=1")).toBe(true);
    expect(p.isAllowed("/search?q=1")).toBe(false);
    expect(p.isAllowed("/search?page=1")).toBe(true);
    expect(p.isAllowed("/exact")).toBe(true);
    expect(p.isAllowed("/exact/more")).toBe(false);
  });

  it("percent-encoding of unreserved characters is normalised; comments and CRLF are handled", () => {
    const p = parseRobots("User-agent: * # all\r\nDisallow: /%7Euser # home dirs\r\n");
    expect(p.isAllowed("/~user/page")).toBe(false);
    expect(p.isAllowed("/%7euser")).toBe(false);
  });

  it("/robots.txt is always allowed; only the first 500 KiB are parsed", () => {
    expect(parseRobots("User-agent: *\nDisallow: /\n").isAllowed("/robots.txt")).toBe(true);
    const big = "User-agent: *\n" + "#".repeat(500 * 1024) + "\nDisallow: /\n";
    expect(parseRobots(big).isAllowed("/")).toBe(true);
  });
});

describe("robotsFromStatus (RFC 9309 2.3.1)", () => {
  it("4xx: no file, everything allowed", () => {
    for (const s of [400, 401, 403, 404, 410, 451]) expect(robotsFromStatus(s).isAllowed("/x"), String(s)).toBe(true);
  });
  it("5xx or unreachable: complete disallow", () => {
    for (const s of [500, 502, 503, "unreachable" as const]) {
      const p = robotsFromStatus(s);
      expect(p.isAllowed("/"), String(s)).toBe(false);
      expect(p.isAllowed("/robots.txt")).toBe(true);
    }
  });
});
