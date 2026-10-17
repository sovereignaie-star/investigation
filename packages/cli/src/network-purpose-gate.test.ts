/**
 * P2-026 (owner decision 2026-10-17 — item 3): the CENTRAL PurposeConfirmation wiring. The
 * engine's natural-person gate (naturalPersonGate) becomes the single enforcement point for
 * natural-person-gated runs in the CLI paths — `ir run --network` (planNetworkRun) AND
 * `ir investigate` (networkRunFor) both build the confirmation from the case itself (the stated
 * purpose + the ledger's actor) and route every natural-person-gated run — subject-level (a
 * person_name subject) or transform-level (a natural_person_gate manifest) — through the
 * engine's gate, fail-closed. Not per-transform.
 *
 * RED FIRST (the honest record): these tests were written BEFORE the wiring. The gap they pin:
 * the investigate path (networkRunFor) did not enforce the case-purpose requirement on a
 * natural-person subject AT ALL — only `ir run` (planNetworkRun) checked it — and neither path
 * built a PurposeConfirmation (the engine's mechanism was unwired in the CLI paths; the
 * documented open owner question in the P2-026 STATUS row). A purpose-less case cannot be
 * created through the store (E-01 refuses it at creation), so the legacy shape is exercised
 * through a database double — exactly the pre-P1-028 shape the run-path check guards against.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { openCase, type Case, type Vault } from "@ir/store";
import { abuseIpDbCheck, hunterDomainEmails } from "@ir/transforms";
import { openGateway, networkRunFor, planNetworkRun, purposeConfirmationFor, type NetworkDeps } from "./network.ts";
import type { RegisteredTransform } from "./registry.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const MODULE = fileURLToPath(import.meta.url); // exists; the plan only checks existence

function newCase(purpose = "مراجعة بنية تحتية مصرح بها", actor = "test"): Case {
  const dir = mkdtempSync(path.join(tmpdir(), "ir-purpose-gate-"));
  dirs.push(dir);
  return openCase(dir, {
    actor,
    create: { title: "P2-026 purpose gate", purpose, legalBasis: "security_incident" },
  });
}

/** The legacy pre-P1-028 database double: a case whose record has no stated purpose. E-01 makes
 *  creating this shape through the store impossible — the double is the only honest way to pin
 *  the fail-closed behavior (the TR-051 precedent for the manifest-level gate). */
function legacyCase(purpose = "", actor = "legacy-actor"): Case {
  return {
    info: () => ({ id: "case-legacy", purpose }),
    ledger: { actor },
    audit: () => ({}),
  } as unknown as Case;
}

function fakeVault(entries: Record<string, string | undefined>): Vault {
  return {
    list: () => Object.keys(entries).map((name) => ({ name, updatedAt: "2026-10-17T00:00:00.000Z" })),
    has: (name) => name in entries,
    set: () => {
      throw new Error("not used in tests");
    },
    delete: () => false,
    reveal: (name) => entries[name],
    // P2-026 (credential_pair extension): the double serves single secrets only — a pair
    // entry is never synthesized, and kindOf reports what the double actually holds
    // (same pattern as the network-secret.test.ts double).
    setPair: () => {
      throw new Error("not used in tests");
    },
    revealPair: () => undefined,
    kindOf: (name) => (name in entries ? "secret" : undefined),
  };
}

/** Minimal network deps: fake resolver/transport, the network opt-in, no secrets needed. */
function deps(): NetworkDeps {
  return {
    env: { IR_ENABLE_NETWORK: "1" },
    resolver: { resolve: async () => [] },
    transport: {
      async fetch() {
        return { status: 200, body: "{}" };
      },
    },
    vault: () => fakeVault({}),
  };
}

/** A person-subject entry: the manifest is normal — the SUBJECT (person_name) is what the
 *  natural-person gate is about here. The transform is never invoked in these tests. */
const personEntry: RegisteredTransform = {
  transform: abuseIpDbCheck,
  module: MODULE,
  subjects: { person_name: (_v: string) => ({ ip: "8.8.8.8" }) },
  sends: ["ip"],
  hosts: ["api.abuseipdb.com"],
  pageFetch: false,
};

/** A natural_person_gate MANIFEST entry (the TR-051 shape: the response carries people's data). */
const personManifestEntry: RegisteredTransform = {
  transform: hunterDomainEmails,
  module: MODULE,
  subjects: { domain: (v) => ({ domain: v }) },
  sends: ["domain"],
  hosts: ["api.hunter.io"],
  pageFetch: false,
};

/** A plain non-person entry: guards against over-blocking (a purposeless case must not stop
 *  ordinary domain runs — the gate is for natural-person data only). */
const domainEntry: RegisteredTransform = {
  transform: abuseIpDbCheck,
  module: MODULE,
  subjects: { domain: (v) => ({ domain: v }) },
  sends: ["domain"],
  hosts: ["api.abuseipdb.com"],
  pageFetch: false,
};

describe("P2-026 (item 3): the central PurposeConfirmation wiring — the engine's gate is the CLI's enforcement point", () => {
  it("purposeConfirmationFor builds the confirmation from the case itself: the stated purpose + the ledger's actor", () => {
    const c = newCase("غرض مصرح به موثق", "investigator-a");
    const confirmation = purposeConfirmationFor(c);
    expect(confirmation).toEqual({ purpose: "غرض مصرح به موثق", confirmedBy: "investigator-a" });
  });

  it("a natural-person SUBJECT on a purpose-stating case passes the engine's gate (the positive control)", () => {
    const c = newCase();
    const gw = openGateway(c, ["api.abuseipdb.com"], deps());
    if ("error" in gw) throw new Error(gw.error);
    const plan = networkRunFor(c, gw, personEntry, "person_name", deps());
    expect("error" in plan).toBe(false);
  });

  it("RED (the investigate path did not enforce it): a natural-person SUBJECT on a purpose-less legacy case is refused by networkRunFor — fail-closed before any plan is built", () => {
    const c = legacyCase();
    const gw = openGateway(c, ["api.abuseipdb.com"], deps());
    if ("error" in gw) throw new Error(gw.error);
    const plan = networkRunFor(c, gw, personEntry, "person_name", deps());
    expect("error" in plan).toBe(true);
    if (!("error" in plan)) throw new Error("expected a refusal");
    expect(plan.error).toMatch(/natural-person|E-02|purpose/);
  });

  it("the same refusal holds on the run path (planNetworkRun) — both CLI paths, one mechanism", () => {
    const c = legacyCase();
    const plan = planNetworkRun(c, personEntry, "person_name", ["api.abuseipdb.com"], deps());
    expect("error" in plan).toBe(true);
    if (!("error" in plan)) throw new Error("expected a refusal");
    expect(plan.error).toMatch(/natural-person|E-02|purpose/);
  });

  it("an empty ledger actor is a fail-closed refusal too (the engine's gate requires a confirmer, not just a purpose)", () => {
    const c = legacyCase("غرض موجود لكن بلا موثِّق", "");
    const gw = openGateway(c, ["api.abuseipdb.com"], deps());
    if ("error" in gw) throw new Error(gw.error);
    const plan = networkRunFor(c, gw, personEntry, "person_name", deps());
    expect("error" in plan).toBe(true);
  });

  it("a natural_person_gate MANIFEST (the TR-051 shape) is refused on a purpose-less case on BOTH paths", () => {
    const c = legacyCase();
    const run = planNetworkRun(c, personManifestEntry, "domain", ["api.hunter.io"], deps());
    expect("error" in run).toBe(true);
    const gw = openGateway(c, ["api.hunter.io"], deps());
    if ("error" in gw) throw new Error(gw.error);
    const investigate = networkRunFor(c, gw, personManifestEntry, "domain", deps());
    expect("error" in investigate).toBe(true);
  });

  it("no over-blocking: a plain domain run on a purpose-less legacy case still builds (the gate is for natural-person data only)", () => {
    const c = legacyCase();
    const gw = openGateway(c, ["api.abuseipdb.com"], deps());
    if ("error" in gw) throw new Error(gw.error);
    const plan = networkRunFor(c, gw, domainEntry, "domain", deps());
    expect("error" in plan).toBe(false);
  });
});
