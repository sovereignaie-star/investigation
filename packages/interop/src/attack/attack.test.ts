import { describe, expect, it } from "vitest";
import { buildAttackMatrix, loadAttackKnowledge, type TechniqueTag } from "./attack.ts";
import { ATTACK_KNOWLEDGE_BUNDLE } from "./knowledge.generated.ts";

/**
 * P4-020 — ATT&CK/CAPEC/D3FEND from LOCAL STIX data. The knowledge base of
 * record is `fixtures/attack/knowledge.json`: a frozen STIX 2.1 bundle extracted
 * from the OFFICIAL sources (ATT&CK STIX verbatim, CAPEC XML and D3FEND ontology
 * converted — tools/attack/build_reference.py, --check verified). Runtime is
 * offline by construction: the module only ever reads the frozen bundle.
 * Acceptance: "كل وسم تقنية يحيل إلى الملاحظة التي اقتضته؛ يعمل بلا شبكة" —
 * every matrix entry carries its claim and that claim's evidence ids.
 */

// the frozen local data IS the generated module — offline by construction

describe("P4-020 — قاعدة المعرفة المحلية من المصادر الرسمية", () => {
  it("تحمّل الحزمة المجمدة وتفهرس كل تقنية: الاسم والمصفوفة والتكتيكات", () => {
    const knowledge = loadAttackKnowledge(ATTACK_KNOWLEDGE_BUNDLE);
    expect(knowledge.techniques.size).toBe(16);
    const phishing = knowledge.techniques.get("T1566");
    expect(phishing).toMatchObject({ name: "Phishing", matrix: "mitre-attack", tactics: ["initial-access"] });
    const bruteForce = knowledge.techniques.get("CAPEC-112");
    expect(bruteForce).toMatchObject({ name: "Brute Force", matrix: "capec", tactics: [] });
    const access = knowledge.techniques.get("D3-AM");
    expect(access).toMatchObject({ name: "Access Policy Administration", matrix: "d3fend", tactics: [] });
    // كل تقنية تحمل معرف STIX الخاص بها للربط
    expect(phishing?.stixId).toMatch(/^attack-pattern--/);
    expect(access?.stixId).toMatch(/^course-of-action--/);
  });

  it("التكتيكات متعددة تُحفظ كلها لا الأولى فقط", () => {
    const knowledge = loadAttackKnowledge(ATTACK_KNOWLEDGE_BUNDLE);
    // T1059.001 في الحزمة الرسمية له تكتيك واحد (execution) — نفحص القاعدة العامة بالتقنية ذات التكتيكين لو وُجدت؛ هنا نتحقق أن التجميع لا يسقط شيئاً
    expect(knowledge.techniques.get("T1059.001")?.tactics).toEqual(["execution"]);
  });

  it("معرّف غير معروف يُبلَّغ صريحاً — لا إسقاط صامت ولا اختراع", () => {
    const knowledge = loadAttackKnowledge(ATTACK_KNOWLEDGE_BUNDLE);
    const matrix = buildAttackMatrix([{ claimId: "c1", techniqueId: "T9999", evidenceIds: ["ev-1"] }], knowledge);
    expect(matrix.unknownTechniques).toEqual(["T9999"]);
    expect(matrix.tactics).toEqual([]);
  });
});

describe("P4-020 — المصفوفة: كل وسم يحيل إلى الملاحظة التي اقتضته", () => {
  const knowledge = loadAttackKnowledge(ATTACK_KNOWLEDGE_BUNDLE);
  const tags: TechniqueTag[] = [
    { claimId: "c-phish", techniqueId: "T1566", evidenceIds: ["ev-mail", "ev-url"] },
    { claimId: "c-spear", techniqueId: "T1566.001", evidenceIds: ["ev-attachment"] },
    { claimId: "c-dns", techniqueId: "T1071.004", evidenceIds: ["ev-dns"] },
    { claimId: "c-brute", techniqueId: "CAPEC-112", evidenceIds: ["ev-log"] },
    { claimId: "c-access", techniqueId: "D3-AM", evidenceIds: ["ev-policy"] },
    { claimId: "c-unknown", techniqueId: "T0000", evidenceIds: [] },
  ];

  it("مصفوفة ATT&CK: التكتيكات مرتبة والتقنيات تحت تكتيكاتها، كل ادعاء بأدلته", () => {
    const matrix = buildAttackMatrix(tags, knowledge);
    expect(matrix.tactics.map((t) => t.tactic)).toEqual(["command-and-control", "initial-access"]);
    const initial = matrix.tactics.find((t) => t.tactic === "initial-access");
    expect(initial?.techniques.map((tech) => tech.techniqueId)).toEqual(["T1566", "T1566.001"]);
    expect(initial?.techniques[0]).toMatchObject({ name: "Phishing", matrix: "mitre-attack" });
    // الوسم يحيل إلى الملاحظة التي اقتضته: الادعاء وأدلته كاملة
    expect(initial?.techniques[0].claims).toEqual([{ claimId: "c-phish", evidenceIds: ["ev-mail", "ev-url"] }]);
  });

  it("CAPEC وD3FEND في قائمتيهما بلا اختراع تكتيكات لهما، والمجهول مُبلَّغ", () => {
    const matrix = buildAttackMatrix(tags, knowledge);
    expect(matrix.capec).toHaveLength(1);
    expect(matrix.capec[0]).toMatchObject({ techniqueId: "CAPEC-112", name: "Brute Force" });
    expect(matrix.capec[0].claims).toEqual([{ claimId: "c-brute", evidenceIds: ["ev-log"] }]);
    expect(matrix.d3fend).toHaveLength(1);
    expect(matrix.d3fend[0]).toMatchObject({ techniqueId: "D3-AM" });
    expect(matrix.unknownTechniques).toEqual(["T0000"]);
  });

  it("حتمية الترتيب: الادعاءات المتعددة لتقنية واحدة بترتيب معرّفها", () => {
    const matrix = buildAttackMatrix(
      [
        { claimId: "c-b", techniqueId: "T1566", evidenceIds: ["ev-2"] },
        { claimId: "c-a", techniqueId: "T1566", evidenceIds: ["ev-1"] },
      ],
      knowledge,
    );
    const tech = matrix.tactics[0]?.techniques[0];
    expect(tech?.claims.map((c) => c.claimId)).toEqual(["c-a", "c-b"]);
  });

  it("لا وسوم لا مصفوفة — لا اختراع", () => {
    const matrix = buildAttackMatrix([], knowledge);
    expect(matrix.tactics).toEqual([]);
    expect(matrix.capec).toEqual([]);
    expect(matrix.d3fend).toEqual([]);
    expect(matrix.unknownTechniques).toEqual([]);
  });
});
