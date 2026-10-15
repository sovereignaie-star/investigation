/**
 * P2-011 — TR-026 contract test (T-RULE-06). Runs the OFAC SDN transform against
 * a deterministic sim and asserts SDN matches; the gate (E-02) is enforced by the engine.
 * The fixture mirrors the official schema (sdnList/sdnEntry/aka), verified against the live file
 * downloaded 2026-10-15.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { ofacSdn } from "./transforms/tr-026-ofac-sdn.ts";
import { runTransform } from "./runner.ts";

function sdnFile(entries: Array<{ uid: string; lastName: string; firstName?: string; type: string; akas?: string[] }>): string {
  const body = entries
    .map((e) => {
      const aka = (e.akas ?? []).map((a) => `<aka><category>strong</category><lastName>${a}</lastName></aka>`).join("");
      const first = e.firstName ? `<firstName>${e.firstName}</firstName>` : "";
      return `<sdnEntry><uid>${e.uid}</uid><lastName>${e.lastName}</lastName>${first}<sdnType>${e.type}</sdnType><akaList>${aka}</akaList></sdnEntry>`;
    })
    .join("");
  return `<?xml version="1.0" standalone="yes"?>
<sdnList xmlns="https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/XML">
  <publshInformation><Publish_Date>10/14/2026</Publish_Date></publshInformation>
  ${body}
</sdnList>`;
}

const MATCH = /^https:\/\/www\.treasury\.gov\/ofac\/downloads\/sdn\.xml$/;

/** D-018: every emitted object value must satisfy its catalog type's own pattern. */
import { specById, matchesSpec } from "@ir/core/identifiers";

function expectCatalogValid(type: string, value: string): void {
  const spec = specById(type);
  if (!spec) throw new Error(`catalog type ${type} exists`);
  const m = matchesSpec(spec, value);
  expect(m.pattern, `${type} pattern accepts "${value}"`).toBe(true);
}

describe("TR-026 ofac sdn", () => {
  it("an entity name in the file yields an sdn_uid finding with the party's uid", async () => {
    const file = sdnFile([{ uid: "36", lastName: "AEROCARIBBEAN AIRLINES", type: "Entity", akas: ["AERO-CARIBBEAN"] }]);
    const sim = createSimServer([{ match: MATCH, response: { status: 200, body: file } }]);
    const result = await runTransform(ofacSdn, { transport: sim.transport, input: { name: "AEROCARIBBEAN AIRLINES" } });
    expect(result.requestCount).toBe(1);
    const findings = result.output.findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ predicate: "is_on_sdn_list", objectType: "sdn_uid", objectValue: "36" });
    expect(findings[0].evidence).toHaveLength(1);
    expectCatalogValid("sdn_uid", findings[0].objectValue);
  });

  it("an aka match yields the party's uid (the official file stores akas under akaList)", async () => {
    const file = sdnFile([{ uid: "36", lastName: "AEROCARIBBEAN AIRLINES", type: "Entity", akas: ["AERO-CARIBBEAN"] }]);
    const sim = createSimServer([{ match: MATCH, response: { status: 200, body: file } }]);
    const result = await runTransform(ofacSdn, { transport: sim.transport, input: { name: "AERO-CARIBBEAN" } });
    expect(result.output.findings).toHaveLength(1);
    expect(result.output.findings[0].objectValue).toBe("36");
    expectCatalogValid("sdn_uid", result.output.findings[0].objectValue);
  });

  it("an individual with first+last name yields the party's uid", async () => {
    const file = sdnFile([{ uid: "173", lastName: "Kroshkin", firstName: "Danil", type: "Individual" }]);
    const sim = createSimServer([{ match: MATCH, response: { status: 200, body: file } }]);
    const result = await runTransform(ofacSdn, { transport: sim.transport, input: { name: "Danil Kroshkin" } });
    expect(result.output.findings).toHaveLength(1);
  });

  it("a name not in the file yields an empty finding, not an error", async () => {
    const file = sdnFile([{ uid: "36", lastName: "AEROCARIBBEAN AIRLINES", type: "Entity" }]);
    const sim = createSimServer([{ match: MATCH, response: { status: 200, body: file } }]);
    const result = await runTransform(ofacSdn, { transport: sim.transport, input: { name: "John Doe" } });
    expect(result.output.findings).toEqual([]);
  });

  it("rejects a too-short name before any request (fail-closed)", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(ofacSdn, { transport: sim.transport, input: { name: "ab" } })).rejects.toThrow(/invalid name/);
    expect(sim.requestCount()).toBe(0);
  });

  it("a wrong-root document (an HTML error page) fails the run, never silently returns an empty list", async () => {
    const html = "<html><body>Service unavailable</body></html>";
    const sim = createSimServer([{ match: MATCH, response: { status: 200, body: html } }]);
    await expect(runTransform(ofacSdn, { transport: sim.transport, input: { name: "John Doe" } })).rejects.toThrow(
      /wrong root element|not an XML document/,
    );
  });

  it("an unterminated sdnEntry fails the run, never silently returns fewer parties", async () => {
    const broken = '<?xml version="1.0"?><sdnList><sdnEntry><uid>36</uid><lastName>X</lastName>';
    const sim = createSimServer([{ match: MATCH, response: { status: 200, body: broken } }]);
    await expect(runTransform(ofacSdn, { transport: sim.transport, input: { name: "John Doe" } })).rejects.toThrow(/unterminated sdnEntry/);
  });

  it("an sdnEntry without a uid fails the run", async () => {
    const broken = '<?xml version="1.0"?><sdnList><sdnEntry><lastName>X</lastName></sdnEntry></sdnList>';
    const sim = createSimServer([{ match: MATCH, response: { status: 200, body: broken } }]);
    await expect(runTransform(ofacSdn, { transport: sim.transport, input: { name: "John Doe" } })).rejects.toThrow(/without a uid/);
  });
});
