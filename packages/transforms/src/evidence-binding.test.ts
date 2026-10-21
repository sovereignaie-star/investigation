/**
 * T-EVB (P2-036) — the evidence contract between a run's findings and its recorded requests.
 *
 * Every finding of a run that made requests names the response(s) it was derived from by `requestId`; the id is
 * assigned when the request is issued, so concurrent requests that settle out of order keep their own ids; a finding
 * that cites nothing, an unknown request, or a request that never answered is a failed run; a request failure the
 * transform swallowed is a failed run, never an empty success. Nothing is bound to "the last response".
 */
import { describe, expect, it } from "vitest";
import type { HttpTransport } from "@ir/engine/transport";
import { defineTransform } from "./manifest.ts";
import { runTransform, TransformRunError } from "./runner.ts";

const MANIFEST = {
  id: "TR-010",
  version: "1.0.0",
  inputs: ["url"],
  outputs: ["url"],
  network: { mode: "public" as const, allow: [] },
  secrets: [],
  limits: { rps: 100, timeoutMs: 10_000, maxBytes: 1_000_000 },
  sensitivity: "normal" as const,
  license: "LC-B",
  admiralty: { reliability: "B", credibility: 3, rationale: "وسيط موثوق نسبياً — تثبيت اختبار" },
};

/** A transport whose responses settle after a per-URL delay (so completion order != issue order). */
function delayedTransport(delays: Record<string, number>, fail: ReadonlySet<string> = new Set()): HttpTransport {
  return {
    async fetch(req) {
      await new Promise((r) => setTimeout(r, delays[req.url] ?? 0));
      if (fail.has(req.url)) throw new Error(`boom ${req.url}`);
      return { status: 200, body: `body of ${req.url}`, headers: { "content-type": "text/plain" } };
    },
  };
}

const URLS = ["https://a.example/", "https://b.example/", "https://c.example/"];

describe("T-EVB: every finding is bound to the response it was derived from", () => {
  it("T-EVB-001: three concurrent requests settling out of order — each finding cites its own request, not the last", async () => {
    const def = defineTransform<{ url: string }>(MANIFEST, async (_input, ctx) => {
      const responses = await Promise.all(URLS.map((u) => ctx.http.get(u)));
      return {
        findings: responses.map((res, i) => ({
          predicate: "links_to",
          evidence: [res.requestId],
          objectType: "url",
          objectValue: URLS[i],
          confidence: 1,
          explanation: res.body,
        })),
      };
    });
    // a settles last, c first: the recorded array is in completion order c, b, a.
    const result = await runTransform(def, {
      transport: delayedTransport({ [URLS[0]]: 30, [URLS[1]]: 15, [URLS[2]]: 0 }),
      input: { url: URLS[0] },
    });
    expect(result.evidence.map((e) => e.url)).toEqual([URLS[2], URLS[1], URLS[0]]);
    expect(result.evidence.map((e) => e.requestId)).toEqual([2, 1, 0]);
    for (const f of result.output.findings) {
      const cited = (f.evidence ?? []).map((id) => result.evidence.find((e) => e.requestId === id));
      expect(cited).toHaveLength(1);
      // The cited record is the request that fetched this very URL — not the last-recorded record (URLS[0]).
      expect(cited[0]?.url).toBe(f.objectValue);
      expect(cited[0]?.body).toBe(`body of ${f.objectValue}`);
    }
    // Distinct findings cite distinct records.
    expect(new Set(result.output.findings.map((f) => f.evidence?.[0])).size).toBe(3);
  });

  it("T-EVB-002: a finding may rest on several responses and cites each of them", async () => {
    const def = defineTransform<{ url: string }>(MANIFEST, async (_input, ctx) => {
      const a = await ctx.http.get(URLS[0]);
      const b = await ctx.http.get(URLS[1]);
      return {
        findings: [
          {
            predicate: "links_to",
            evidence: [a.requestId, b.requestId],
            objectType: "url",
            objectValue: URLS[1],
            confidence: 1,
            explanation: "x",
          },
        ],
      };
    });
    const result = await runTransform(def, { transport: delayedTransport({}), input: { url: URLS[0] } });
    expect(result.output.findings[0].evidence).toEqual([0, 1]);
  });

  it("T-EVB-003: each record keeps url, method, status, body and a fetch time from the caller's clock", async () => {
    const def = defineTransform<{ url: string }>(MANIFEST, async (input, ctx) => {
      const res = await ctx.http.get(input.url);
      return {
        findings: [
          { predicate: "links_to", evidence: [res.requestId], objectType: "url", objectValue: input.url, confidence: 1, explanation: "x" },
        ],
      };
    });
    const result = await runTransform(def, {
      transport: delayedTransport({}),
      input: { url: URLS[0] },
      fetchedAt: () => "2026-01-02T03:04:05.000Z",
    });
    expect(result.evidence[0]).toMatchObject({
      requestId: 0,
      fetchedAt: "2026-01-02T03:04:05.000Z",
      url: URLS[0],
      method: "GET",
      status: 200,
      body: `body of ${URLS[0]}`,
    });
  });

  it("T-EVB-004: a finding without evidence in a run that made requests fails validation (no binding by guess)", async () => {
    const def = defineTransform<{ url: string }>(MANIFEST, async (_input, ctx) => {
      await ctx.http.get(URLS[0]);
      await ctx.http.get(URLS[1]);
      return { findings: [{ predicate: "links_to", objectType: "url", objectValue: URLS[1], confidence: 1, explanation: "x" }] };
    });
    const err = await runTransform(def, { transport: delayedTransport({}), input: { url: URLS[0] } }).catch((e) => e);
    expect(err).toBeInstanceOf(TransformRunError);
    expect(err.stage).toBe("validation");
    expect(err.message).toMatch(/cites no evidence/);
    // The responses are still kept on the error for the case record.
    expect(err.evidence).toHaveLength(2);
  });

  it("T-EVB-005: a finding citing an unknown request id fails validation", async () => {
    const def = defineTransform<{ url: string }>(MANIFEST, async (input, ctx) => {
      await ctx.http.get(input.url);
      return {
        findings: [{ predicate: "links_to", evidence: [7], objectType: "url", objectValue: input.url, confidence: 1, explanation: "x" }],
      };
    });
    const err = await runTransform(def, { transport: delayedTransport({}), input: { url: URLS[0] } }).catch((e) => e);
    expect(err.stage).toBe("validation");
    expect(err.message).toMatch(/cites request 7/);
  });

  it("T-EVB-006: a swallowed request failure is a failed run, not an empty success", async () => {
    const def = defineTransform<{ url: string }>(MANIFEST, async (_input, ctx) => {
      try {
        await ctx.http.get(URLS[1]);
      } catch {
        // the transform hides the failure and reports "nothing found"
      }
      return { findings: [] };
    });
    const err = await runTransform(def, { transport: delayedTransport({}, new Set([URLS[1]])), input: { url: URLS[0] } }).catch((e) => e);
    expect(err).toBeInstanceOf(TransformRunError);
    expect(err.stage).toBe("request");
    expect(err.message).toMatch(/request 0 failed/);
    expect(err.evidence[0]).toMatchObject({ requestId: 0, url: URLS[1] });
    expect(err.evidence[0].error).toBeDefined();
  });

  it("T-EVB-007: a swallowed failure next to a successful response still fails the run (no partial success)", async () => {
    const def = defineTransform<{ url: string }>(MANIFEST, async (_input, ctx) => {
      const ok = await ctx.http.get(URLS[0]);
      await ctx.http.get(URLS[1]).catch(() => undefined);
      return {
        findings: [
          { predicate: "links_to", evidence: [ok.requestId], objectType: "url", objectValue: URLS[0], confidence: 1, explanation: "x" },
        ],
      };
    });
    const err = await runTransform(def, { transport: delayedTransport({}, new Set([URLS[1]])), input: { url: URLS[0] } }).catch((e) => e);
    expect(err.stage).toBe("request");
    expect(err.message).toMatch(/request 1 failed/);
  });

  it("T-EVB-008: derivedFrom input is accepted; citing both input and responses is refused", async () => {
    const both = defineTransform<{ url: string }>(MANIFEST, async (input, ctx) => {
      const res = await ctx.http.get(input.url);
      return {
        findings: [
          {
            predicate: "links_to",
            evidence: [res.requestId],
            derivedFrom: "input",
            objectType: "url",
            objectValue: input.url,
            confidence: 1,
            explanation: "x",
          },
        ],
      };
    });
    const err = await runTransform(both, { transport: delayedTransport({}), input: { url: URLS[0] } }).catch((e) => e);
    expect(err.stage).toBe("validation");
    expect(err.message).toMatch(/both/);

    const fromInput = defineTransform<{ url: string }>(MANIFEST, async (input, ctx) => {
      const res = await ctx.http.get(input.url);
      return {
        findings: [
          { predicate: "links_to", derivedFrom: "input", objectType: "url", objectValue: input.url, confidence: 1, explanation: "rule" },
          {
            predicate: "links_to",
            evidence: [res.requestId],
            objectType: "url",
            objectValue: input.url,
            confidence: 1,
            explanation: "seen",
          },
        ],
      };
    });
    const ok = await runTransform(fromInput, { transport: delayedTransport({}), input: { url: URLS[0] } });
    expect(ok.output.findings.map((f) => f.derivedFrom ?? f.evidence)).toEqual(["input", [0]]);
  });

  it("T-EVB-009: a run that made no request cannot cite a response", async () => {
    const def = defineTransform<{ url: string }>(MANIFEST, async (input) => ({
      findings: [{ predicate: "links_to", evidence: [0], objectType: "url", objectValue: input.url, confidence: 1, explanation: "x" }],
    }));
    const err = await runTransform(def, { transport: delayedTransport({}), input: { url: URLS[0] } }).catch((e) => e);
    expect(err.stage).toBe("validation");
    expect(err.message).toMatch(/cites request 0/);
  });
});
