/**
 * P2-011 — TR-027 contract test (T-RULE-06). Runs the UN SC Consolidated List transform against
 * a deterministic sim and asserts reference-number matches; the gate (E-02) is enforced by the engine.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { unScConsolidated } from "./transforms/tr-027-un-sc.ts";
import { runTransform } from "./runner.ts";

function unFile(parties: Array<{ ref: string; type: "INDIVIDUAL" | "ENTITY"; names: string[] }>): string {
  const body = parties
    .map((p) => {
      const names = p.names.map((n) => `<NAME>${n}</NAME>`).join("");
      return `<${p.type}><REFERENCE_NUMBER>${p.ref}</REFERENCE_NUMBER>${names}</${p.type}>`;
    })
    .join("");
  return `<CONSOLIDATED_LIST>${body}</CONSOLIDATED_LIST>`;
}

const MATCH = /^https:\/\/main\.un\.org\/securitycouncil\/sites\/un\.org\/files\/sc-sanctions-list\/xml\/consolidated\.xml$/;

describe("TR-027 un sc consolidated", () => {
  it("a name in the file yields an un_reference finding with the party's reference number", async () => {
    const file = unFile([{ ref: "CTi.47018", type: "INDIVIDUAL", names: ["Danil Kroshkin"] }]);
    const sim = createSimServer([{ match: MATCH, response: { status: 200, body: file } }]);
    const result = await runTransform(unScConsolidated, { transport: sim.transport, input: { name: "Danil Kroshkin" } });
    expect(result.requestCount).toBe(1);
    const findings = result.output.findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ predicate: "is_on_un_sc_list", objectType: "un_reference", objectValue: "CTi.47018" });
    expect(findings[0].evidence).toHaveLength(1);
  });

  it("a name not in the file yields an empty finding, not an error", async () => {
    const file = unFile([{ ref: "CTi.47018", type: "INDIVIDUAL", names: ["Danil Kroshkin"] }]);
    const sim = createSimServer([{ match: MATCH, response: { status: 200, body: file } }]);
    const result = await runTransform(unScConsolidated, { transport: sim.transport, input: { name: "John Doe" } });
    expect(result.output.findings).toEqual([]);
  });

  it("rejects a too-short name before any request (fail-closed)", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(unScConsolidated, { transport: sim.transport, input: { name: "ab" } })).rejects.toThrow(/invalid name/);
    expect(sim.requestCount()).toBe(0);
  });

  it("a malformed file (unterminated INDIVIDUAL) fails the run, never silently returns fewer parties", async () => {
    const broken = "<CONSOLIDATED_LIST><INDIVIDUAL><REFERENCE_NUMBER>CTi.47018</REFERENCE_NUMBER><NAME>X</NAME>";
    const sim = createSimServer([{ match: MATCH, response: { status: 200, body: broken } }]);
    await expect(runTransform(unScConsolidated, { transport: sim.transport, input: { name: "John Doe" } })).rejects.toThrow(
      /unterminated INDIVIDUAL/,
    );
  });
});
