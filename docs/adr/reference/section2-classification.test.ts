import { describe, expect, it } from "vitest";
import { classifyDataKind, classifySection2, type Section2Input } from "./section2-classification.ts";

/** A minimal valid input: everything present, nothing sensitive, nothing sent. */
const base: Section2Input = {
  caseId: "case-1",
  purposeRef: "purpose-1",
  sensitivity: "normal",
  sends: [],
  inventory: {},
};

describe("reference model for ADR-08 Section 2 (pure, not the gateway)", () => {
  it("allows a fully classified, declared, non-sensitive request", () => {
    const input: Section2Input = {
      ...base,
      sends: ["domain"],
      inventory: { urlQuery: ["domain"], body: ["domain"] },
    };
    expect(classifySection2(input)).toEqual({ decision: "allow", reason: "ok" });
  });

  it("denies a request with no case or purpose before anything else (missing_case)", () => {
    expect(classifySection2({ ...base, caseId: undefined })).toEqual({
      decision: "deny",
      reason: "missing_case",
    });
    expect(classifySection2({ ...base, purposeRef: undefined })).toEqual({
      decision: "deny",
      reason: "missing_case",
    });
  });

  it("denies when sensitivity is ABSENT: missing classification never becomes an allow", () => {
    const { sensitivity: _s, ...withoutSensitivity } = base;
    expect(classifySection2(withoutSensitivity as Section2Input)).toEqual({
      decision: "deny",
      reason: "unclassified_data",
    });
  });

  it("denies an UNKNOWN sensitivity value not in the closed enum", () => {
    expect(classifySection2({ ...base, sensitivity: "public" })).toEqual({
      decision: "deny",
      reason: "unclassified_data",
    });
    expect(classifySection2({ ...base, sensitivity: "internal" })).toEqual({
      decision: "deny",
      reason: "unclassified_data",
    });
  });

  it("denies an unknown case sensitivity", () => {
    expect(classifySection2({ ...base, caseSensitivity: "top-secret" })).toEqual({
      decision: "deny",
      reason: "unclassified_data",
    });
  });

  it("denies natural_person_gate by default (P2-013 not adopted)", () => {
    expect(classifySection2({ ...base, sensitivity: "natural_person_gate" })).toEqual({
      decision: "deny",
      reason: "natural_person",
    });
  });

  it("denies sensitive and restricted CASES by default too", () => {
    expect(classifySection2({ ...base, caseSensitivity: "sensitive" })).toEqual({
      decision: "deny",
      reason: "natural_person",
    });
    expect(classifySection2({ ...base, caseSensitivity: "restricted" })).toEqual({
      decision: "deny",
      reason: "natural_person",
    });
  });

  it("still requires sends to be declared even when the natural-person policy is adopted", () => {
    const input: Section2Input = {
      ...base,
      sensitivity: "natural_person_gate",
      naturalPersonPolicyAdopted: true,
      sends: ["id_card"],
      inventory: { body: ["id_card", "passport"] }, // passport NOT declared
    };
    expect(classifySection2(input)).toEqual({
      decision: "deny",
      reason: "undeclared_data",
    });
  });

  it("denies when the manifest is missing the sends field entirely (missing_manifest)", () => {
    const { sends: _d, ...noSends } = base;
    expect(classifySection2(noSends as Section2Input)).toEqual({
      decision: "deny",
      reason: "missing_manifest",
    });
  });

  it("treats an EMPTY sends list as valid but allowing NOTHING: any data kind is undeclared", () => {
    const input: Section2Input = { ...base, sends: [], inventory: { urlQuery: ["domain"] } };
    expect(classifySection2(input)).toEqual({
      decision: "deny",
      reason: "undeclared_data",
    });
  });

  it("denies a data kind present in ANY surface but not declared (url, headers, body, path)", () => {
    for (const surface of ["urlQuery", "headers", "body", "pathParams"] as const) {
      const input: Section2Input = {
        ...base,
        sends: ["domain"],
        inventory: { [surface]: ["domain", "email"] },
      };
      expect(classifySection2(input), surface).toEqual({
        decision: "deny",
        reason: "undeclared_data",
      });
    }
  });

  it("allows minor sensitivity but marks no-auto-expansion (E-08)", () => {
    expect(classifySection2({ ...base, sensitivity: "minor" })).toEqual({
      decision: "allow",
      reason: "minor_no_auto_expansion",
    });
  });

  it("classifyDataKind refuses to DOWNGRADE: registry wins over the transform's claim", () => {
    // The transform claims "normal" but the registry says natural_person_gate.
    expect(classifyDataKind("id_card", "natural_person_gate")).toEqual({
      decision: "deny",
      reason: "natural_person",
    });
    expect(classifyDataKind("domain", "normal")).toEqual({ decision: "allow", reason: "ok" });
    expect(classifyDataKind("minor_thing", "minor")).toEqual({
      decision: "allow",
      reason: "minor_no_auto_expansion",
    });
  });

  it("classifyDataKind denies an unknown registry classification", () => {
    expect(classifyDataKind("x", "who-knows")).toEqual({
      decision: "deny",
      reason: "unclassified_data",
    });
  });

  it("deduplicates repeated kinds across surfaces before checking", () => {
    const input: Section2Input = {
      ...base,
      sends: ["domain"],
      inventory: { urlQuery: ["domain"], body: ["domain"], headers: ["domain"] },
    };
    expect(classifySection2(input)).toEqual({ decision: "allow", reason: "ok" });
  });
});
