/**
 * P2-011 — TR-028 contract test (T-RULE-06). Runs the EU sanctions list transform against
 * a deterministic sim and asserts reference-number matches; the gate (E-02) is enforced by the engine.
 * The fixture mirrors the official schema (export/sanctionEntity with euReferenceNumber, subjectType
 * code, nameAlias wholeName), verified against the live file downloaded 2026-10-15.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { euSanctions } from "./transforms/tr-028-eu-sanctions.ts";
import { runTransform } from "./runner.ts";

function euFile(entries: Array<{ ref: string; type: "person" | "enterprise"; wholeNames: string[] }>): string {
  const body = entries
    .map((e) => {
      const aliases = e.wholeNames.map((n) => `<nameAlias wholeName="${n}"><regulationSummary/></nameAlias>`).join("");
      return `<sanctionEntity designationDetails="" unitedNationId="" euReferenceNumber="${e.ref}" logicalId="1"><remark></remark><subjectType code="${e.type}"/>${aliases}</sanctionEntity>`;
    })
    .join("\n    ");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<export xmlns="http://eu.europa.ec/fpi/fsd/export" generationDate="2026-10-12T12:27:34.779+02:00" globalFileId="1">
    ${body}
</export>`;
}

// The token is a PUBLIC constant the EU open-data catalog publishes in every record (placeholder, not a
// secret). The plain literal does NOT trigger gitleaks (verified 2026-10-15 with the CI-pinned
// 8.30.1) — the earlier base64 derivation was unnecessary and violated the founding rule against
// hiding a value by encoding it just to silence the secrets check. It stays visible in plain text.
const TOKEN = "token-2017";
// The sim rule must see the same URL the transform builds (the token comes from the env at run time).
process.env.IR_EU_FSD_TOKEN = TOKEN;
const MATCH = (token: string) =>
  new RegExp(`^https://webgate\\.ec\\.europa\\.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content\\?token=${token}$`);
const MATCH_RULE = MATCH(TOKEN);

/** D-018: every emitted object value must satisfy its catalog type's own pattern. */
import { specById, matchesSpec } from "@ir/core/identifiers";

import { probeIsolation } from "@ir/transform-sandbox";
// The module-load probe doubles as the warmup: it pays the launcher build + probe cost here,
// OUTSIDE any test's 5s timeout (the first sandboxed test would otherwise pay it and time out).
// P2-028 (owner decision): no skipIf — the tests RUN wherever this file loads; without full
// isolation they fail honestly (the CI gates job now installs bubblewrap too).
await probeIsolation();

function expectCatalogValid(type: string, value: string): void {
  const spec = specById(type);
  if (!spec) throw new Error(`catalog type ${type} exists`);
  const m = matchesSpec(spec, value);
  expect(m.pattern, `${type} pattern accepts "${value}"`).toBe(true);
}

describe("TR-028 eu sanctions", () => {
  it("a person wholeName in the file yields an eu_reference finding with the party's reference number", async () => {
    const file = euFile([{ ref: "EU.27.28", type: "person", wholeNames: ["Saddam Hussein Al-Tikriti"] }]);
    const sim = createSimServer([{ match: MATCH_RULE, response: { status: 200, body: file } }]);
    const result = await runTransform(euSanctions, { transport: sim.transport, input: { name: "Saddam Hussein Al-Tikriti" } });
    expect(result.requestCount).toBe(1);
    const findings = result.output.findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ predicate: "is_on_eu_sanctions_list", objectType: "eu_reference", objectValue: "EU.27.28" });
    expect(findings[0].evidence).toHaveLength(1);
    expectCatalogValid("eu_reference", findings[0].objectValue);
  });

  it("an enterprise (a group's wholeName) yields the party's reference number", async () => {
    const file = euFile([{ ref: "EU.16.62", type: "enterprise", wholeNames: ["Arab Revolutionary Brigades"] }]);
    const sim = createSimServer([{ match: MATCH_RULE, response: { status: 200, body: file } }]);
    const result = await runTransform(euSanctions, { transport: sim.transport, input: { name: "Arab Revolutionary Brigades" } });
    expect(result.output.findings).toHaveLength(1);
    expect(result.output.findings[0].objectValue).toBe("EU.16.62");
    expectCatalogValid("eu_reference", result.output.findings[0].objectValue);
  });

  it("a name not in the file yields an empty finding, not an error", async () => {
    const file = euFile([{ ref: "EU.27.28", type: "person", wholeNames: ["Saddam Hussein Al-Tikriti"] }]);
    const sim = createSimServer([{ match: MATCH_RULE, response: { status: 200, body: file } }]);
    const result = await runTransform(euSanctions, { transport: sim.transport, input: { name: "John Doe" } });
    expect(result.output.findings).toEqual([]);
  });

  it("rejects a too-short name before any request (fail-closed)", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(euSanctions, { transport: sim.transport, input: { name: "ab" } })).rejects.toThrow(/invalid name/);
    expect(sim.requestCount()).toBe(0);
  });

  it("a wrong-root document (an HTML error page) fails the run, never silently returns an empty list", async () => {
    const html = "<html><body>Service unavailable</body></html>";
    const sim = createSimServer([{ match: MATCH_RULE, response: { status: 200, body: html } }]);
    await expect(runTransform(euSanctions, { transport: sim.transport, input: { name: "John Doe" } })).rejects.toThrow(
      /wrong root element|not an XML document/,
    );
  });

  it("an unterminated sanctionEntity fails the run, never silently returns fewer parties", async () => {
    const broken =
      '<?xml version="1.0"?><export xmlns="http://eu.europa.ec/fpi/fsd/export"><sanctionEntity designationDetails="" unitedNationId="" euReferenceNumber="EU.27.28" logicalId="1"><subjectType code="person"/><nameAlias wholeName="X">';
    const sim = createSimServer([{ match: MATCH_RULE, response: { status: 200, body: broken } }]);
    await expect(runTransform(euSanctions, { transport: sim.transport, input: { name: "John Doe" } })).rejects.toThrow(
      /unterminated sanctionEntity/,
    );
  });

  it("a sanctionEntity without an euReferenceNumber fails the run", async () => {
    const broken =
      '<?xml version="1.0"?><export xmlns="http://eu.europa.ec/fpi/fsd/export"><sanctionEntity designationDetails="" logicalId="1"><subjectType code="person"/><nameAlias wholeName="X"><regulationSummary/></nameAlias></sanctionEntity></export>';
    const sim = createSimServer([{ match: MATCH_RULE, response: { status: 200, body: broken } }]);
    await expect(runTransform(euSanctions, { transport: sim.transport, input: { name: "John Doe" } })).rejects.toThrow(
      /without an euReferenceNumber/,
    );
  });
});

/**
 * P2-011 review fix (2026-10-15) — the isolated path is the production path (`ir run --network` requires
 * isolation), and the sandbox does NOT inherit the parent's environment: without the manifest's `env`
 * declaration the token could never reach the child. These tests prove the declared name arrives over
 * IPC, and that without it the run fails closed BEFORE any transport call. Skipped where the sandbox
 * cannot provide "full" isolation (same rule as T-ISO).
 */
import { fileURLToPath } from "node:url";
import { TransformRunError } from "./runner.ts";

const MODULE = fileURLToPath(new URL("./transforms/tr-028-eu-sanctions.ts", import.meta.url));

describe("TR-028 isolated (production path: the sandbox does not inherit the parent env)", () => {
  const ORIGINAL = process.env.IR_EU_FSD_TOKEN;

  it("the manifest-declared env name reaches the sandboxed child over IPC: the run succeeds and the URL carries the token", async () => {
    const file = euFile([{ ref: "EU.27.28", type: "person", wholeNames: ["Saddam Hussein Al-Tikriti"] }]);
    const sim = createSimServer([{ match: MATCH_RULE, response: { status: 200, body: file } }]);
    process.env.IR_EU_FSD_TOKEN = TOKEN; // the public catalog constant appears only in this test file, never in production source
    try {
      const result = await runTransform(undefined, {
        transport: sim.transport,
        input: { name: "Saddam Hussein Al-Tikriti" },
        requireIsolation: true,
        isolatedModule: MODULE,
        transformId: "TR-028",
      });
      expect(result.requestCount).toBe(1);
      expect(sim.requestCount()).toBe(1);
      expect(sim.requests[0].url).toContain(`token=${TOKEN}`);
      expect(result.output.findings[0]?.objectValue).toBe("EU.27.28");
    } finally {
      process.env.IR_EU_FSD_TOKEN = ORIGINAL;
    }
  });

  it("without the token the run fails closed BEFORE any transport call — nothing leaves", async () => {
    const sim = createSimServer([{ match: MATCH_RULE, response: { status: 200, body: euFile([]) } }]);
    delete process.env.IR_EU_FSD_TOKEN;
    try {
      const err = await runTransform(undefined, {
        transport: sim.transport,
        input: { name: "Saddam Hussein Al-Tikriti" },
        requireIsolation: true,
        isolatedModule: MODULE,
        transformId: "TR-028",
      }).catch((e) => e);
      expect(err).toBeInstanceOf(TransformRunError);
      expect(err.message).toContain("IR_EU_FSD_TOKEN");
      expect(sim.requestCount()).toBe(0); // the refusal happened before any request left
    } finally {
      process.env.IR_EU_FSD_TOKEN = ORIGINAL;
    }
  });
});
