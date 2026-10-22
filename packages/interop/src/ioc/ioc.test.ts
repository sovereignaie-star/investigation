import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { collectIndicators, defang, iocListExport, mispExport, mispImport, openIocExport, type IocIndicator } from "./ioc.ts";
import type { Graph } from "@ir/ledger/projections";

/**
 * P4-022 — تصدير مؤشرات التهديد: MISP JSON وOpenIOC وقوائم IOC نصية/CSV مع
 * خيار التمويه. The reference case of record is the P4-014 fixture (the same
 * lineage: a case with the four indicator types plus entities that are NOT
 * indicators). Acceptance: "دورة تصدير/استيراد MISP بلا فقد على قضية مرجعية" —
 * the MISP round-trip loses nothing. Defanging applies to the SHARING lists
 * (text/CSV); the machine formats (MISP/OpenIOC) keep true values so the
 * round-trip and automated ingestion never see disguised data — documented,
 * not assumed.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const referenceCase = JSON.parse(readFileSync(join(root, "fixtures", "stix", "reference-case.json"), "utf8")) as {
  description: string;
  graph: Graph;
};

const sortedPairs = (list: readonly IocIndicator[]): string =>
  list
    .map((i) => `${i.type}:${i.value}`)
    .sort()
    .join("\n");

describe("P4-022 — جمع المؤشرات من القضية المرجعية", () => {
  it("collects the four indicator types and reports the non-indicator entities honestly", () => {
    const { indicators, skipped } = collectIndicators(referenceCase.graph);
    expect(sortedPairs(indicators)).toBe(
      [
        "domain:holdings.example",
        "email:info@holdings.example",
        "ipv4:192.0.2.7",
        "sha256_hash:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      ]
        .sort()
        .join("\n"),
    );
    // الشخص والشركة ليستا مؤشري تهديد — مُبلَّغان لا مسكوت عنهما
    expect(skipped.map((s) => s.type).sort()).toEqual(["company", "person"]);
  });

  it("an empty graph yields nothing — no invention", () => {
    const { indicators, skipped } = collectIndicators({ nodes: [], edges: [] } as unknown as Graph);
    expect(indicators).toEqual([]);
    expect(skipped).toEqual([]);
  });
});

describe("P4-022 — دورة MISP بلا فقد (التصدير ثم الاستيراد)", () => {
  const event = mispExport(referenceCase.graph, { timestamp: "2026-10-23T10:00:00.000Z" });

  it("exports a MISP event with properly typed attributes and deterministic ids", () => {
    const attrs = event.Event.Attribute;
    expect(attrs).toHaveLength(4);
    const byType = new Map(attrs.map((a) => [a.type, a.value]));
    expect(byType.get("domain")).toBe("holdings.example");
    expect(byType.get("ip-src")).toBe("192.0.2.7");
    expect(byType.get("sha256")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(byType.get("email-src")).toBe("info@holdings.example");
    // معرفات حتمية: التصدير مرتين يعطي البايتات نفسها
    const again = mispExport(referenceCase.graph, { timestamp: "2026-10-23T10:00:00.000Z" });
    expect(JSON.stringify(again)).toBe(JSON.stringify(event));
  });

  it("round-trips without loss: import(export(case)) recovers the exact indicator set", () => {
    const imported = mispImport(event);
    const { indicators } = collectIndicators(referenceCase.graph);
    expect(sortedPairs(imported.indicators)).toBe(sortedPairs(indicators));
  });

  it("import refuses malformed input — fail-closed", () => {
    expect(() => mispImport({ noEvent: true } as never)).toThrow();
    expect(() => mispImport({ Event: { Attribute: "ليست قائمة" } } as never)).toThrow();
  });
});

describe("P4-022 — التمويه (defang) للقوائم", () => {
  it("defangs URLs, dots and at-signs — the standard sharing disguise", () => {
    expect(defang("http://evil.example/payload")).toBe("hxxp://evil[.]example/payload");
    expect(defang("https://bank.example")).toBe("hxxps://bank[.]example");
    expect(defang("user@example.com")).toBe("user[at]example[.]com");
  });

  it("text list: one value per line, defanged only when asked", () => {
    const plain = iocListExport(referenceCase.graph, { format: "text", defang: false });
    expect(plain.split("\n")).toContain("holdings.example");
    expect(plain).toContain("192.0.2.7");
    const defanged = iocListExport(referenceCase.graph, { format: "text", defang: true });
    expect(defanged).toContain("holdings[.]example");
    expect(defanged).toContain("info[at]holdings[.]example");
    expect(defanged).not.toContain("info@holdings.example");
  });

  it("csv list: a header and type,value rows — defanged values only when asked", () => {
    const csv = iocListExport(referenceCase.graph, { format: "csv", defang: false });
    expect(csv.split("\n")[0]).toBe("type,value");
    expect(csv).toContain("domain,holdings.example");
    expect(csv).toContain("ipv4,192.0.2.7");
    const csvDefanged = iocListExport(referenceCase.graph, { format: "csv", defang: true });
    expect(csvDefanged).toContain("domain,holdings[.]example");
    expect(csvDefanged).not.toContain("domain,holdings.example");
  });
});

describe("P4-022 — OpenIOC", () => {
  it("exports a valid OpenIOC 1.1 document with every indicator as an IndicatorItem", () => {
    const xml = openIocExport(referenceCase.graph);
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>\n<iocs xmlns="http:\/\/schemas\.mandiant\.com\/2010\/ioc">/);
    expect((xml.match(/<IndicatorItem /g) ?? []).length).toBe(4);
    expect(xml).toContain('<Content type="string">holdings.example</Content>');
    // حتمي: تصديران متطابقان
    expect(openIocExport(referenceCase.graph)).toBe(xml);
  });

  it("escapes XML-special characters in values — never emits broken XML", () => {
    const graph: Graph = {
      nodes: [
        {
          id: "d9",
          type: "domain",
          canonicalKey: "domain:a&b<c",
          labels: { ar: "a&b<c" },
          props: {},
          aliases: [],
          attributes: [],
        },
      ],
      edges: [],
    } as unknown as Graph;
    const xml = openIocExport(graph);
    expect(xml).toContain("a&amp;b&lt;c");
    expect(xml).not.toContain("a&b<c");
  });
});
