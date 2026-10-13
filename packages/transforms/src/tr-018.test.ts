/**
 * P2-010 — TR-018 contract test (T-RULE-06). Runs the Wikidata transform against
 * a deterministic sim and asserts entity findings.
 */
import { describe, expect, it } from "vitest";
import { createSimServer } from "@ir/sim/server";
import { wikidataEntity } from "./transforms/tr-018-wikidata.ts";
import { runTransform } from "./runner.ts";

describe("TR-018 wikidata", () => {
  it("emits label and description findings", async () => {
    const sim = createSimServer([
      {
        match: /^https:\/\/www\.wikidata\.org\/w\/api\.php\?action=wbgetentities/,
        response: {
          status: 200,
          body: JSON.stringify({
            entities: { Q42: { labels: { en: { value: "Douglas Adams" } }, descriptions: { en: { value: "English writer" } } } },
          }),
        },
      },
    ]);
    const result = await runTransform(wikidataEntity, { transport: sim.transport, input: { qid: "Q42" } });
    expect(result.requestCount).toBe(1);
    const findings = result.output.findings;
    expect(findings).toContainEqual(
      expect.objectContaining({ predicate: "has_display_name", objectType: "url", objectValue: "https://www.wikidata.org/wiki/Q42" }),
    );
    expect(findings).toContainEqual(expect.objectContaining({ predicate: "has_description", objectType: "url" }));
  });

  it("rejects an invalid QID before any request (fail-closed)", async () => {
    const sim = createSimServer([]);
    await expect(runTransform(wikidataEntity, { transport: sim.transport, input: { qid: "not-a-qid" } })).rejects.toThrow(
      /invalid Wikidata QID/,
    );
    expect(sim.requestCount()).toBe(0);
  });
});
