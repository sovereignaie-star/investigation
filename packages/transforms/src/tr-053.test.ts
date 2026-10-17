/**
 * TR-053 contract test (T-RULE-06). Runs the Brave web-search transform against a deterministic
 * sim and asserts exact findings. The manifest declares a secret (pinned mode); the sim stands in
 * for the egress gateway that would inject the `X-Subscription-Token` header; no real key or
 * connection is used.
 *
 * THE RESTRICTED EVIDENCE STORAGE (the owner decision 2026-10-17 — Brave's terms forbid storing
 * Search Results): the manifest declares restrictedEvidence, and the RUNNER — not the transform —
 * replaces the raw response body in the evidence record with a sha256 digest envelope. What is
 * stored: the query (the request URL), the time (fetchedAt), the links (the findings), the hash
 * and the byte count — nothing else. The raw response content reaches NO persisted record.
 *
 * NOTE on sim `match` values (P2-026): fully-escaped RegExp LITERALS (anchored exact match,
 * every dot/question mark escaped), not plain URL strings — CodeQL's js/incomplete-hostname-regexp
 * flags plain URL strings flowing into the sim server's `new RegExp`; an escaped literal is not
 * flagged (precedent: tr-052.test.ts collinfo) and the runtime semantics are EQUIVALENT for
 * these fixed URLs (the sim's plain-string branch is exact equality). One documented JS nuance:
 * `$` also matches before a trailing newline; no URL in these tests contains one, so the passing
 * suite pins the equivalence on every exercised path.
 *
 * RED FIRST (the J-1 rule): written before the transform existed — the red round is the module's
 * own absence (the import fails to load), then each behavior below is pinned.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { braveWebSearch } from "./transforms/tr-053-brave-web-search.ts";
import { runTransform } from "./runner.ts";

const RAW_BODY = JSON.stringify({
  web: {
    results: [
      { url: "https://example.com/about", title: "About Example", description: "MARKER-RAW-CONTENT-1" },
      { url: "https://news.example.org/story", title: "Story", description: "MARKER-RAW-CONTENT-2" },
    ],
  },
});

function braveDeps(overrides: Record<string, unknown> = {}) {
  const sim = createSimServer([
    {
      match: /^https:\/\/api\.search\.brave\.com\/res\/v1\/web\/search\?q=example\.com$/,
      response: { status: 200, body: RAW_BODY, ...overrides },
    },
  ]);
  return sim;
}

describe("TR-053 brave-web-search (restricted evidence)", () => {
  it("emits one mentioned_in claim per result link for a domain subject", async () => {
    const result = await runTransform(braveWebSearch, {
      transport: braveDeps().transport,
      input: { domain: "example.com" },
    });
    expect(result.requestCount).toBe(1);
    expect(result.output.findings).toContainEqual(
      expect.objectContaining({
        predicate: "mentioned_in",
        objectType: "url",
        objectValue: "https://example.com/about",
        evidence: [0],
      }),
    );
    expect(result.output.findings).toHaveLength(2);
  });

  it("emits the same claims for a person-name subject (the query is the name)", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/api\.search\.brave\.com\/res\/v1\/web\/search\?q=Jane%20Doe$/,
        response: { status: 200, body: RAW_BODY },
      },
    ]);
    const result = await runTransform(braveWebSearch, { transport: sim.transport, input: { name: "Jane Doe" } });
    expect(result.requestCount).toBe(1);
    expect(result.output.findings).toHaveLength(2);
  });

  it("RESTRICTED: the evidence record carries the sha256 digest envelope, NOT the raw body", async () => {
    const result = await runTransform(braveWebSearch, {
      transport: braveDeps().transport,
      input: { domain: "example.com" },
    });
    const ev = result.evidence[0];
    expect(ev).toBeDefined();
    expect(ev.body).toBeDefined();
    // the body IS the digest envelope (parse it back): the sha256 of the raw response + its length
    const envelope = JSON.parse(ev.body ?? "") as { sha256?: unknown; bytes?: unknown };
    expect(envelope.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(envelope.bytes).toBe(RAW_BODY.length);
    // ...and it is NOT the raw response: no result content marker survives
    expect(ev.body).not.toContain("MARKER-RAW-CONTENT");
    expect(ev.body).not.toContain("example.com/about");
  });

  it("RESTRICTED: the envelope's sha256 is the digest of the exact raw response", async () => {
    const result = await runTransform(braveWebSearch, {
      transport: braveDeps().transport,
      input: { domain: "example.com" },
    });
    const envelope = JSON.parse(result.evidence[0]?.body ?? "") as { sha256: string };
    const { createHash } = await import("node:crypto");
    expect(envelope.sha256).toBe(createHash("sha256").update(RAW_BODY).digest("hex"));
  });

  it("an empty result set is a true negative — no claims, no error", async () => {
    const result = await runTransform(braveWebSearch, {
      transport: braveDeps({ body: JSON.stringify({ web: { results: [] } }) }).transport,
      input: { domain: "example.com" },
    });
    expect(result.requestCount).toBe(1);
    expect(result.output.findings).toHaveLength(0);
  });

  it("a result without a valid URL is skipped, never guessed (D-018)", async () => {
    const result = await runTransform(braveWebSearch, {
      transport: braveDeps({
        body: JSON.stringify({ web: { results: [{ title: "no url" }, { url: "https://valid.example.net/x" }] } }),
      }).transport,
      input: { domain: "example.com" },
    });
    expect(result.output.findings).toHaveLength(1);
    expect(result.output.findings[0]?.objectValue).toBe("https://valid.example.net/x");
  });

  it("refuses a malformed response (no web object)", async () => {
    await expect(
      runTransform(braveWebSearch, {
        transport: braveDeps({ body: JSON.stringify({ type: "error" }) }).transport,
        input: { domain: "example.com" },
      }),
    ).rejects.toThrow(/malformed response/);
  });

  it("refuses the input when neither name nor domain is set, and when both are", async () => {
    await expect(runTransform(braveWebSearch, { transport: createSimServer([]).transport, input: {} })).rejects.toThrow(
      /exactly one of name or domain/,
    );
    await expect(
      runTransform(braveWebSearch, {
        transport: createSimServer([]).transport,
        input: { name: "Jane Doe", domain: "example.com" },
      }),
    ).rejects.toThrow(/only one of name or domain/);
  });

  it("declares the restricted-evidence policy and the person gate in its manifest", () => {
    expect(braveWebSearch.manifest.restrictedEvidence).toBe(true);
    expect(braveWebSearch.manifest.sensitivity).toBe("natural_person_gate");
    expect(braveWebSearch.manifest.license).toBe("LC-D");
  });
});
