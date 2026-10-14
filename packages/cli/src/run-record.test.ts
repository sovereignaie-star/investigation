/**
 * T-RUNREC (P2-036) — a multi-request run written into a real case: every finding's observations cite the evidence
 * of the request it was derived from, never the last stored response; failures cite the failed request; the chain
 * verifies and the graph rebuilds from the chain.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalKey, manualClock, ulidFactory } from "@ir/core";
import { project, projectionHash } from "@ir/ledger/projections";
import { openCase, verifyCase } from "@ir/store";
import { dnsResolve, TransformRunError, type RunTransformResult, type TransformEvidence } from "@ir/transforms";
import { recordRunFailure, recordRunSuccess } from "./run-record.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeCase() {
  const dir = mkdtempSync(path.join(tmpdir(), "ir-runrec-"));
  dirs.push(dir);
  const clock = manualClock("2026-10-14T09:00:00.000Z");
  const c = openCase(dir, {
    actor: "analyst",
    clock,
    create: { title: "t", purpose: "مراجعة بنية تحتية", legalBasis: "security_incident" },
  });
  const subjectId = ulidFactory(clock)();
  c.ledger.append("entity.added", {
    id: subjectId,
    type: "domain",
    canonicalKey: canonicalKey("domain", "example.com"),
    labels: { en: "example.com" },
    props: {},
  });
  return { dir, c, clock, subjectId };
}

const ev = (requestId: number, url: string, body: string, extra: Partial<TransformEvidence> = {}): TransformEvidence => ({
  requestId,
  fetchedAt: `2026-10-14T09:00:0${requestId}.000Z`,
  url,
  method: "GET",
  status: 200,
  headers: { "content-type": "application/dns-json" },
  body,
  ...extra,
});

/** Evidence of the stored record a claim's observations cite, by request URL. */
function citedUrls(c: ReturnType<typeof makeCase>["c"]) {
  const entries = c.entries();
  const evidence = new Map(
    entries
      .filter((e) => e.kind === "evidence.stored")
      .map((e) => {
        const p = e.payload as { id: string; request: { url: string; status?: number }; fetchedAt: string };
        return [p.id, p];
      }),
  );
  const claims = entries
    .filter((e) => e.kind === "claim.added")
    .map((e) => e.payload as { id: string; predicate: string; value?: unknown });
  const obs = entries
    .filter((e) => e.kind === "observation.added")
    .map((e) => e.payload as { claimId?: string; entityId?: string; evidenceId: string; kind: string; note?: string });
  return { evidence, claims, obs };
}

describe("T-RUNREC: findings bound to their own evidence in the case", () => {
  it("T-RUNREC-001: three responses stored out of order — each claim cites the response it came from, not the last", () => {
    const { dir, c, clock, subjectId } = makeCase();
    const A = "https://dns.google/resolve?name=example.com&type=A";
    const MX = "https://dns.google/resolve?name=example.com&type=MX";
    const NS = "https://dns.google/resolve?name=example.com&type=NS";
    const result: RunTransformResult = {
      requestCount: 3,
      // completion order NS, A, MX — the stored "last" record would be MX
      evidence: [ev(2, NS, "ns"), ev(0, A, "a"), ev(1, MX, "mx")],
      output: {
        findings: [
          { predicate: "resolves_to", evidence: [0], objectType: "ipv4", objectValue: "192.0.2.7", confidence: 1, explanation: "A" },
          {
            predicate: "has_nameserver",
            evidence: [2],
            objectType: "hostname",
            objectValue: "ns1.example.net",
            confidence: 1,
            explanation: "NS",
          },
        ],
      },
    };
    const rec = recordRunSuccess(c, subjectId, dnsResolve, { domain: "example.com" }, result, clock);
    expect(rec.requests.map((r) => r.requestId)).toEqual([0, 1, 2]);
    const { evidence, claims, obs } = citedUrls(c);
    const urlOf = (predicate: string) => {
      const claim = claims.find((x) => x.predicate === predicate);
      return obs.filter((o) => o.claimId === claim?.id).map((o) => evidence.get(o.evidenceId)?.request.url);
    };
    expect(urlOf("resolves_to")).toEqual([A]);
    expect(urlOf("has_nameserver")).toEqual([NS]);
    // Each record keeps url, status and its own fetch time.
    const nsRecord = [...evidence.values()].find((e) => e.request.url === NS);
    expect(nsRecord).toMatchObject({ request: { status: 200 }, fetchedAt: "2026-10-14T09:00:02.000Z" });
    const p = project(c.entries());
    expect(p.issues).toEqual([]);
    const hash = projectionHash(p);
    c.close();
    const report = verifyCase(dir);
    expect(report.ok).toBe(true);
    expect(report.evidence.problems).toEqual([]);
    // The graph rebuilds from the stored chain to the same projection.
    const reopened = openCase(dir, { actor: "verifier", readOnly: true });
    expect(projectionHash(project(reopened.entries()))).toBe(hash);
    reopened.close();
  });

  it("T-RUNREC-002: an empty output records one negative observation per response checked", () => {
    const { c, clock, subjectId } = makeCase();
    const result: RunTransformResult = {
      requestCount: 2,
      evidence: [ev(0, "https://dns.google/a", "{}"), ev(1, "https://dns.google/b", "{}")],
      output: { findings: [] },
    };
    const rec = recordRunSuccess(c, subjectId, dnsResolve, { domain: "example.com" }, result, clock);
    expect(rec.negative).toBe(true);
    const { evidence, obs } = citedUrls(c);
    const negatives = obs.filter((o) => o.kind === "negative");
    expect(negatives.map((o) => evidence.get(o.evidenceId)?.request.url)).toEqual(["https://dns.google/a", "https://dns.google/b"]);
    c.close();
  });

  it("T-RUNREC-003: a failed request is cited by the error observation, not the last successful response", () => {
    const { c, clock, subjectId } = makeCase();
    const failed = ev(1, "https://dns.google/fail", "", { status: undefined, error: { kind: "refused", message: "host not allowed" } });
    const x = new TransformRunError("request", "request 1 failed (refused)", [
      ev(0, "https://dns.google/ok", "{}"),
      failed,
      ev(2, "https://dns.google/later", "{}"),
    ]);
    recordRunFailure(c, subjectId, dnsResolve, { domain: "example.com" }, x, clock);
    const { evidence, obs } = citedUrls(c);
    const errors = obs.filter((o) => o.kind === "error");
    expect(errors).toHaveLength(1);
    expect(evidence.get(errors[0].evidenceId)?.request.url).toBe("https://dns.google/fail");
    expect(evidence.get(errors[0].evidenceId)?.request.status).toBeUndefined();
    expect(errors[0].note).toMatch(/^\[request\] /);
    // No claim came out of a failed run.
    expect(c.entries().some((e) => e.kind === "claim.added")).toBe(false);
    c.close();
  });

  it("T-RUNREC-004: a validation failure cites a run record that lists every response received", () => {
    const { c, clock, subjectId } = makeCase();
    const x = new TransformRunError("validation", "finding 0 cites no evidence", [
      ev(0, "https://dns.google/a", "{}"),
      ev(1, "https://dns.google/b", "{}"),
    ]);
    recordRunFailure(c, subjectId, dnsResolve, { domain: "example.com" }, x, clock);
    const { evidence, obs } = citedUrls(c);
    const error = obs.find((o) => o.kind === "error");
    const cited = error ? evidence.get(error.evidenceId) : undefined;
    expect(cited?.request.url).toBe("local://ir-run");
    expect(evidence.size).toBe(3);
    c.close();
  });

  it("T-RUNREC-005: a finding derived from the input cites the run record, never a source response", () => {
    const { c, clock, subjectId } = makeCase();
    const result: RunTransformResult = {
      requestCount: 1,
      evidence: [ev(0, "https://dns.google/a", "{}")],
      output: {
        findings: [
          {
            predicate: "is_disposable",
            derivedFrom: "input",
            objectType: "boolean",
            objectValue: "true",
            confidence: 0.9,
            explanation: "list",
          },
        ],
      },
    };
    recordRunSuccess(c, subjectId, dnsResolve, { domain: "example.com" }, result, clock);
    const { evidence, obs } = citedUrls(c);
    const positive = obs.find((o) => o.kind === "positive");
    expect(positive ? evidence.get(positive.evidenceId)?.request.url : undefined).toBe("local://ir-run");
    c.close();
  });
});
