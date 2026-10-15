/**
 * P2-011 — TR-026 contract test (T-RULE-06). Runs the OFAC SDN transform against
 * a deterministic sim and asserts SDN matches; the gate (E-02) is enforced by the engine.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { ofacSdn } from "./transforms/tr-026-ofac-sdn.ts";
import { runTransform } from "./runner.ts";

function sdnFile(entries: Array<{ uid: string; name: string; aliases?: string[] }>): string {
  const body = entries
    .map((e) => {
      const aliases = (e.aliases ?? []).map((a) => `<alias>${a}</alias>`).join("");
      return `<party uid="${e.uid}"><name>${e.name}</name><category>Individual</category>${aliases}</party>`;
    })
    .join("");
  return `<sdnList>${body}</sdnList>`;
}

describe("TR-026 ofac sdn", () => {
  it("a name in the file yields an sdn_uid finding with the party's uid", async () => {
    const file = sdnFile([{ uid: "9754", name: "Danil Kroshkin", aliases: ["Danil Kroshkin", "D. Kroshkin"] }]);
    const sim = createSimServer([
      { match: /^https:\/\/www\.treasury\.gov\/ofac\/downloads\/sdn\.xml$/, response: { status: 200, body: file } },
    ]);
    const result = await runTransform(ofacSdn, { transport: sim.transport, input: { name: "Danil Kroshkin" } });
    expect(result.requestCount).toBe(1);
    const findings = result.output.findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ predicate: "is_on_sdn_list", objectType: "sdn_uid", objectValue: "9754" });
    expect(findings[0].evidence).toEqual([result.output.findings[0].evidence?.[0]]);
  });

  it("a name not in the file yields an empty finding, not an error", async () => {
    const file = sdnFile([{ uid: "9754", name: "Danil Kroshkin" }]);
    const sim = createSimServer([
      { match: /^https:\/\/www\.treasury\.gov\/ofac\/downloads\/sdn\.xml$/, response: { status: 200, body: file } },
    ]);
    const result = await runTransform(ofacSdn, { transport: sim.transport, input: { name: "John Doe" } });
    expect(result.output.findings).toEqual([]);
  });

  it("rejects a too-short name before any request (fail-closed)", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(ofacSdn, { transport: sim.transport, input: { name: "ab" } })).rejects.toThrow(/invalid name/);
    expect(sim.requestCount()).toBe(0);
  });

  it("a malformed file (unterminated party) fails the run, never silently returns fewer parties", async () => {
    const broken = '<sdnList><party uid="1"><name>X</name>';
    const sim = createSimServer([
      { match: /^https:\/\/www\.treasury\.gov\/ofac\/downloads\/sdn\.xml$/, response: { status: 200, body: broken } },
    ]);
    await expect(runTransform(ofacSdn, { transport: sim.transport, input: { name: "John Doe" } })).rejects.toThrow(/unterminated party/);
  });
});
