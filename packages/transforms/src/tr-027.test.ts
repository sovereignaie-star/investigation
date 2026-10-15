/**
 * P2-011 — TR-027 contract test (T-RULE-06). Runs the UN SC Consolidated List transform against
 * a deterministic sim and asserts reference-number matches; the gate (E-02) is enforced by the engine.
 * The fixture mirrors the official per-regime schema (CONSOLIDATED_LIST/INDIVIDUALS/INDIVIDUAL with
 * FIRST_NAME..FOURTH_NAME parts, ENTITY with the whole name in FIRST_NAME, ALIAS_NAME), verified
 * against the live Libya file downloaded 2026-10-15.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { unScConsolidated } from "./transforms/tr-027-un-sc.ts";
import { runTransform } from "./runner.ts";

function unFile(entries: Array<{ ref: string; type: "INDIVIDUAL" | "ENTITY"; names: string[]; aliases?: string[] }>): string {
  const body = entries
    .map((e) => {
      const alias = (e.aliases ?? [])
        .map((a) => `<${e.type}_ALIAS><QUALITY>a.k.a.</QUALITY><ALIAS_NAME>${a}</ALIAS_NAME></${e.type}_ALIAS>`)
        .join("");
      if (e.type === "INDIVIDUAL") {
        const [first, second, third, fourth] = [...e.names[0].split(" "), "", "", ""];
        return `<INDIVIDUAL><DATAID>1</DATAID><FIRST_NAME>${first}</FIRST_NAME><SECOND_NAME>${second}</SECOND_NAME><THIRD_NAME>${third}</THIRD_NAME><FOURTH_NAME>${fourth}</FOURTH_NAME><REFERENCE_NUMBER>${e.ref}</REFERENCE_NUMBER>${alias}</INDIVIDUAL>`;
      }
      return `<ENTITY><DATAID>1</DATAID><FIRST_NAME>${e.names[0]}</FIRST_NAME><REFERENCE_NUMBER>${e.ref}</REFERENCE_NUMBER>${alias}</ENTITY>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<CONSOLIDATED_LIST xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="https://www.un.org/sc/resources/sc-sanctions.xsd" dateGenerated="2026-10-14T00:00:10.366Z">
${body}
</CONSOLIDATED_LIST>`;
}

const MATCH = /^https:\/\/main\.un\.org\/securitycouncil\/sites\/un\.org\/files\/sc-sanctions-list\/xml\/consolidated\.xml$/;

describe("TR-027 un sc consolidated", () => {
  it("an individual name in the file yields an un_reference finding with the party's reference number", async () => {
    const file = unFile([{ ref: "LYi.001", type: "INDIVIDUAL", names: ["عبد القادر محمد البغدادي"] }]);
    const sim = createSimServer([{ match: MATCH, response: { status: 200, body: file } }]);
    const result = await runTransform(unScConsolidated, { transport: sim.transport, input: { name: "عبد القادر محمد البغدادي" } });
    expect(result.requestCount).toBe(1);
    const findings = result.output.findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ predicate: "is_on_un_sc_list", objectType: "un_reference", objectValue: "LYi.001" });
    expect(findings[0].evidence).toHaveLength(1);
  });

  it("an entity name (the whole name lives in FIRST_NAME) yields the party's reference number", async () => {
    const file = unFile([{ ref: "LYe.001", type: "ENTITY", names: ["المؤسسة الليبية للاستثمار"] }]);
    const sim = createSimServer([{ match: MATCH, response: { status: 200, body: file } }]);
    const result = await runTransform(unScConsolidated, { transport: sim.transport, input: { name: "المؤسسة الليبية للاستثمار" } });
    expect(result.output.findings).toHaveLength(1);
    expect(result.output.findings[0].objectValue).toBe("LYe.001");
  });

  it("an alias match yields the party's reference number", async () => {
    const file = unFile([
      { ref: "LYe.001", type: "ENTITY", names: ["المؤسسة الليبية للاستثمار"], aliases: ["Libyan Foreign Investment Company (LFIC)"] },
    ]);
    const sim = createSimServer([{ match: MATCH, response: { status: 200, body: file } }]);
    const result = await runTransform(unScConsolidated, {
      transport: sim.transport,
      input: { name: "Libyan Foreign Investment Company (LFIC)" },
    });
    expect(result.output.findings).toHaveLength(1);
  });

  it("a name not in the file yields an empty finding, not an error", async () => {
    const file = unFile([{ ref: "LYi.001", type: "INDIVIDUAL", names: ["عبد القادر محمد البغدادي"] }]);
    const sim = createSimServer([{ match: MATCH, response: { status: 200, body: file } }]);
    const result = await runTransform(unScConsolidated, { transport: sim.transport, input: { name: "John Doe" } });
    expect(result.output.findings).toEqual([]);
  });

  it("rejects a too-short name before any request (fail-closed)", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(unScConsolidated, { transport: sim.transport, input: { name: "ab" } })).rejects.toThrow(/invalid name/);
    expect(sim.requestCount()).toBe(0);
  });

  it("a wrong-root document (an HTML error page) fails the run, never silently returns an empty list", async () => {
    const html = "<html><body>Service unavailable</body></html>";
    const sim = createSimServer([{ match: MATCH, response: { status: 200, body: html } }]);
    await expect(runTransform(unScConsolidated, { transport: sim.transport, input: { name: "John Doe" } })).rejects.toThrow(
      /wrong root element|not an XML document/,
    );
  });

  it("an unterminated INDIVIDUAL fails the run, never silently returns fewer parties", async () => {
    const broken =
      '<?xml version="1.0"?><CONSOLIDATED_LIST><INDIVIDUAL><REFERENCE_NUMBER>LYi.001</REFERENCE_NUMBER><FIRST_NAME>X</FIRST_NAME>';
    const sim = createSimServer([{ match: MATCH, response: { status: 200, body: broken } }]);
    await expect(runTransform(unScConsolidated, { transport: sim.transport, input: { name: "John Doe" } })).rejects.toThrow(
      /unterminated INDIVIDUAL/,
    );
  });

  it("an INDIVIDUAL without a reference number fails the run", async () => {
    const broken = '<?xml version="1.0"?><CONSOLIDATED_LIST><INDIVIDUAL><FIRST_NAME>X</FIRST_NAME></INDIVIDUAL></CONSOLIDATED_LIST>';
    const sim = createSimServer([{ match: MATCH, response: { status: 200, body: broken } }]);
    await expect(runTransform(unScConsolidated, { transport: sim.transport, input: { name: "John Doe" } })).rejects.toThrow(
      /without a reference number/,
    );
  });
});
