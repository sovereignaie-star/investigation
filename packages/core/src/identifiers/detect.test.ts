import { describe, expect, it } from "vitest";
import { accepts, detect, detectBest, expandExample, IDENTIFIER_SPECS } from "./index.ts";

const examples = IDENTIFIER_SPECS.flatMap((s) => s.examples.positive.map((e) => ({ spec: s, value: expandExample(e) })));
const ctxFor = (s: (typeof IDENTIFIER_SPECS)[number]) => (s.context?.required ? s.context.keywords[0] : "");

// B is narrower than A when, on the catalog's own examples, B accepts a strict subset of what A accepts.
const accepted = new Map(IDENTIFIER_SPECS.map((s) => [s.id, new Set(examples.filter((e) => accepts(s, e.value)).map((e) => e.value))]));
const narrower = (b: string, a: string) => {
  const A = accepted.get(a) ?? new Set(),
    B = accepted.get(b) ?? new Set();
  return B.size < A.size && [...B].every((e) => A.has(e));
};
const rankOk = (id: string, value: string, context: string) => {
  const c = detect(value, { context });
  const i = c.findIndex((x) => x.type === id);
  return i >= 0 && c.slice(0, i).every((x) => x.score === c[i]?.score || narrower(x.type, id));
};

describe("detect (P1-006)", () => {
  it("recall 100%: every positive example yields its own type among the candidates", () => {
    const missing = examples.filter(({ spec, value }) => !detect(value, { context: ctxFor(spec) }).some((c) => c.type === spec.id));
    expect(missing.map((m) => m.spec.id)).toEqual([]);
  });

  it("D-005: deterministic (validated) types rank first, tied, or behind a narrower type in at least 99% of cases", () => {
    const det = examples.filter((e) => e.spec.validator);
    const ok = det.filter(({ spec, value }) => rankOk(spec.id, value, ctxFor(spec)));
    expect(ok.length / det.length).toBeGreaterThanOrEqual(0.99);
  });

  it("is far better than first match overall, and context lifts it further", () => {
    const top1 = examples.filter(({ spec, value }) => detectBest(value, { context: ctxFor(spec) })?.type === spec.id).length;
    const withLabel = examples.filter(({ spec, value }) => rankOk(spec.id, value, `${spec.labels.en}: ${ctxFor(spec)}`)).length;
    expect(top1 / examples.length).toBeGreaterThan(0.55); // first match was 14.1%
    expect(withLabel).toBeGreaterThan(top1);
  });

  it("validators veto: a Luhn-failing card or a bad IBAN checksum is not a candidate", () => {
    expect(detect("4111111111111112").some((c) => c.type === "credit_card")).toBe(false);
    expect(detect("GB82WEST12345698765433").some((c) => c.type === "iban")).toBe(false);
    expect(detect("GB82WEST12345698765432")[0]).toMatchObject({ type: "iban", validated: true });
  });

  it("D-007: types sharing a pattern stay separate candidates; context decides between them", () => {
    const plain = detect("johndoe99").map((c) => c.type);
    expect(plain.length).toBeGreaterThan(5);
    expect(detectBest("johndoe99", { context: "github account" })?.type).toMatch(/^github/);
  });

  it("D-009: wickr_id is proposed only with a context keyword", () => {
    expect(detect("agent_smith").some((c) => c.type === "wickr_id")).toBe(false);
    expect(detect("agent_smith", { context: "my wickr is" }).some((c) => c.type === "wickr_id")).toBe(true);
  });

  it("PSL: a registrable domain is a domain, a deeper host is a subdomain", () => {
    expect(detectBest("example.co.uk")?.type).toBe("domain");
    expect(detect("mail.example.co.uk").some((c) => c.type === "domain")).toBe(false);
    expect(detect("mail.example.co.uk").some((c) => c.type === "subdomain")).toBe(true);
  });

  it("is deterministic, sorted, bounded and safe on odd input", () => {
    const a = detect("8.8.8.8"),
      b = detect("8.8.8.8");
    expect(a).toEqual(b);
    for (let i = 1; i < a.length; i++) expect((a[i - 1]?.score ?? 0) >= (a[i]?.score ?? 0)).toBe(true);
    expect(detect("8.8.8.8", { limit: 2 })).toHaveLength(2);
    expect(detect("")).toEqual([]);
    expect(detect("x".repeat(5000))).toEqual([]);
    for (const c of a) expect(c.score).toBeGreaterThan(0);
  });
});
