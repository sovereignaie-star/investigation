import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { IdentifierSpec } from "@ir/schema";
import { accepts, expandExample, IDENTIFIER_SPECS, matchesSpec, patternsOf, specById } from "./index.ts";

const dir = path.resolve(import.meta.dirname, "..", "..", "identifiers");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".yaml"))
  .sort();

describe("identifier catalog (P1-003, P1-004, P1-008)", () => {
  it("T-IDL-001/002: 371 types with unique ids, each valid against IdentifierSpec", () => {
    expect(IDENTIFIER_SPECS.length).toBe(371);
    expect(new Set(IDENTIFIER_SPECS.map((s) => s.id)).size).toBe(371);
    for (const s of IDENTIFIER_SPECS) expect(IdentifierSpec.safeParse(s).error?.issues ?? [], s.id).toEqual([]);
  });

  it("T-IDL-003: every pattern compiles; T-IDL-004: no YAML or generated line over 2,000 characters", () => {
    for (const s of IDENTIFIER_SPECS) expect(() => patternsOf(s), s.id).not.toThrow();
    for (const f of [...files.map((x) => path.join(dir, x)), path.join(import.meta.dirname, "catalog.ts")])
      expect(
        Math.max(
          ...readFileSync(f, "utf8")
            .split("\n")
            .map((l) => l.length),
        ),
        f,
      ).toBeLessThanOrEqual(2000);
  });

  it("the generated catalog is in sync with the YAML (run gen:data after editing)", () => {
    const fromYaml = files.flatMap((f) => parse(readFileSync(path.join(dir, f), "utf8")) as unknown[]);
    expect(IDENTIFIER_SPECS).toEqual(fromYaml);
    for (const f of files) {
      const cats = new Set((parse(readFileSync(path.join(dir, f), "utf8")) as { category: string }[]).map((s) => s.category.toLowerCase()));
      expect([...cats], f).toEqual([f.replace(/\.yaml$/, "")]);
    }
  });

  it("D-006: 100% of positive examples are accepted by their own type (pattern and validator)", () => {
    const failing = IDENTIFIER_SPECS.flatMap((s) =>
      s.examples.positive.map(expandExample).flatMap((ex) => {
        const m = matchesSpec(s, ex);
        return m.pattern && m.valid !== false ? [] : [`${s.id}: ${ex} ${JSON.stringify(m)}`];
      }),
    );
    expect(failing).toEqual([]);
  });

  it("every type has a negative example that its own type rejects", () => {
    const failing = IDENTIFIER_SPECS.flatMap((s) =>
      s.examples.negative.filter((ex) => accepts(s, expandExample(ex))).map((ex) => `${s.id}: ${ex}`),
    );
    expect(failing).toEqual([]);
  });

  it("D-010: messaging types have their own category; D-009: wickr_id needs context", () => {
    const messaging = IDENTIFIER_SPECS.filter((s) => s.category === "Messaging").map((s) => s.id);
    expect(messaging.sort()).toEqual(["signal_number", "skype_id", "telegram_username", "whatsapp_number", "wickr_id"]);
    expect(IDENTIFIER_SPECS.filter((s) => s.category === "Email").every((s) => s.patterns.every((p) => p.includes("@")))).toBe(true);
    expect(specById("wickr_id")?.context).toEqual({ keywords: ["wickr", "ويكر"], required: true });
  });

  it("D-011: identity documents are behind the natural-person gate; a legal-entity number is not", () => {
    const gated = IDENTIFIER_SPECS.filter((s) => s.sensitivity === "natural_person_gate").map((s) => s.id);
    expect(gated.length).toBe(52);
    for (const id of ["passport_generic", "national_id_sa", "iqama_sa", "ssn_us", "aadhar_in", "mrz_line"]) expect(gated).toContain(id);
    expect(specById("cnpj_br")?.sensitivity).toBe("normal");
  });

  it("secret-shaped examples are templates: no literal API-key example is stored", () => {
    const api = IDENTIFIER_SPECS.filter((s) => s.category === "API");
    const literal = api.filter(
      (s) =>
        ["stripe_sk", "openai_key", "slack_token", "github_token_fine", "jwt_token"].includes(s.id) &&
        !s.examples.positive.every((e) => e.includes("{{")),
    );
    expect(literal.map((s) => s.id)).toEqual([]);
    expect(expandExample("sk_test_{{3:x}}")).toBe("sk_test_xxx");
    // negatives of templated types are templates too (GitHub push protection rejects expanded fake keys)
    const literalNeg = IDENTIFIER_SPECS.filter(
      (s) => s.examples.positive.some((e) => e.includes("{{")) && s.examples.negative.some((e) => !e.includes("{{")),
    );
    expect(literalNeg.map((s) => s.id)).toEqual([]);
  });
});
