import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executePlaybook, loadPlaybook, type PlaybookDefinition, type PlaybookInvoke, type PlaybookState } from "./index.ts";

/**
 * P5-008 — الكتب الثمانية الأولى (الملحق C) — T-PLAY-005..016.
 *
 * كل كتاب يعيش في `playbooks/*.yaml` ويُحمّل بمخطط المحرك الصارم، ويُكمَل في
 * عالم المحاكاة بنتيجة مرجعية: استدعاء محقون حتمي (مثل @ir/sim — شبكة مُبرمجة
 * بلا اتصالات خارجية؛ في الإنتاج عدّاء المحوّلات عبر بوابة الخروج) يُرجع مخرجات
 * مرجعية لكل معرّف محوّل. البوابات البشرية مطابقة للملحق C حرفياً.
 */

const BOOKS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "playbooks");
const bookFiles = existsSync(BOOKS_DIR)
  ? readdirSync(BOOKS_DIR)
      .filter((f) => f.endsWith(".yaml"))
      .sort()
  : [];
const books = bookFiles.map((f) => ({ file: f, def: loadPlaybook(readFileSync(path.join(BOOKS_DIR, f), "utf8")) }));
const byId = new Map(books.map((b) => [b.def.id, b.def]));

/** عالم المحاكاة: استدعاء حتمي بلا شبكة — مخرجات مرجعية لكل محوّل معتمد. */
const SIM_RESPONSES: Readonly<Record<string, (seed: string) => unknown>> = {
  "TR-001": (seed) => ({ records: [{ type: "A", value: "93.184.216.34" }], for: seed }),
  "TR-002": (seed) => ({ entity: seed, registered: true, reference: "sim" }),
  "TR-021": (seed) => ({ entity: seed, registered: true, reference: "sim" }),
  "TR-023": (seed) => ({ entity: seed, registered: true, reference: "sim" }),
  "TR-003": () => ({ network: "93.184.216.0/24", owner: "sim-hosting" }),
  "TR-004": (seed) => ({ certificates: [{ cn: `*.${seed}` }], subdomains: [] }),
  "TR-006": () => ({ asn: "AS15133", holder: "sim-edge" }),
  "TR-008": () => ({ ports: [443], banner: "sim-shodan", keyed: true }),
  "TR-011": (seed) => ({ snapshots: [{ timestamp: "2026-01-01T00:00:00Z", digest: "sim" }], for: seed }),
  "TR-012": (seed) => ({ warc: "sim.warc", sha256: "sim-warc-hash", url: seed }),
  "TR-013": () => ({ submitted: true, snapshotUrl: "https://web.archive.org/sim" }),
  "TR-014": (tid) => ({ accounts: [{ platform: tid, handle: "sim-org" }], declared: true }),
  "TR-015": (tid) => ({ accounts: [{ platform: tid, handle: "sim-org" }], declared: true }),
  "TR-016": () => ({ transactions: 3, balance: "sim", chain: "btc" }),
  "TR-017": () => ({ transactions: 5, chain: "eth" }),
  "TR-022": () => ({ officers: [{ name: "sim-officer", role: "director" }] }),
  "TR-025": (seed) => ({ matches: [], screened: seed }),
  "TR-031": (seed) => ({ exif: { make: "sim", gps: null }, source: seed }),
  "TR-032": () => ({ phash: "sim-phash-64bit", dhash: "sim-dhash" }),
  "TR-033": () => ({ links: ["https://lens.example/sim", "https://tineye.example/sim"], manual: true }),
  "TR-035": () => ({ frames: 4, hashes: ["sim-f1", "sim-f2", "sim-f3", "sim-f4"] }),
  "TR-048": () => ({ history: [{ date: "2025-01-01", records: [] }] }),
};

const simInvoke: PlaybookInvoke = async (transformId, input) => {
  const respond = SIM_RESPONSES[transformId];
  if (respond === undefined) throw new Error(`sim world has no scripted response for ${transformId}`);
  const seed = typeof input === "string" ? input : (JSON.stringify(input) ?? "input");
  return respond(transformId === "TR-014" || transformId === "TR-015" ? transformId : seed);
};

/** كتاب بالإيداع — يفشل صريحاً إن لم يوجد (لا تأكيد غير فارغ). */
const must = (id: string): PlaybookDefinition => {
  const def = byId.get(id);
  if (def === undefined) throw new Error(`book ${id} not loaded`);
  return def;
};

const run = (def: PlaybookDefinition, input: string, confirmations: Record<string, { confirmedBy: string }> = {}) =>
  executePlaybook(def, { canonicalInput: input }, { invoke: simInvoke, confirmations });

const runToCompletion = async (def: PlaybookDefinition, input: string): Promise<PlaybookState> => {
  const confirmations: Record<string, { confirmedBy: string }> = {};
  let state = await run(def, input, confirmations);
  let guard = 0;
  while (state.phase === "awaiting_gate" && state.pendingGate && guard++ < 5) {
    confirmations[state.pendingGate.gateId] = { confirmedBy: "investigator-1" };
    state = await run(def, input, confirmations);
  }
  return state;
};

describe("P5-008 — الكتب الثمانية (الملحق C)", () => {
  it("T-PLAY-005: الدليل يحوي الكتب الثمانية بالضبط — PB-01..PB-08 فريدة ومخططة", () => {
    expect(books.map((b) => b.def.id)).toEqual(["PB-01", "PB-02", "PB-03", "PB-04", "PB-05", "PB-06", "PB-07", "PB-08"]);
    expect(new Set(books.map((b) => b.def.id)).size).toBe(8);
  });

  it("T-PLAY-006: PB-01 فحص نطاق — يكتمل بالمرجع، والبوابة قبل المحوّل ذي المفتاح المدفوع فقط", async () => {
    const def = must("PB-01");
    const paused = await run(def, "example.test");
    expect(paused.phase).toBe("awaiting_gate");
    expect(paused.pendingGate?.before).toBe("shodan"); // قبل أي محوّل بمفتاح مدفوع
    expect(paused.completedSteps.map((s) => s.stepId)).not.toContain("shodan");
    const done = await runToCompletion(def, "example.test");
    expect(done.phase).toBe("completed");
    expect(done.completedSteps.map((s) => s.stepId)).toEqual(["dns", "rdap-domain", "certs", "ip-asn", "archive", "shodan"]);
    expect((done.outputs["dns"] as { records: unknown[] }).records).toHaveLength(1);
  });

  it("T-PLAY-007: PB-02 فحص شركة (KYB) — البوابة قبل توسيع المسؤولين (أشخاص)", async () => {
    const def = must("PB-02");
    const paused = await run(def, "SIM-CORP-LTD");
    expect(paused.phase).toBe("awaiting_gate");
    expect(paused.pendingGate?.before).toBe("officers");
    const done = await runToCompletion(def, "SIM-CORP-LTD");
    expect(done.phase).toBe("completed");
    expect(done.completedSteps.map((s) => s.stepId)).toEqual(["gleif", "sanctions", "officers"]);
  });

  it("T-PLAY-008: PB-03 فحص عنوان محفظة — البوابة قبل وسم العنوان بجهة", async () => {
    const def = must("PB-03");
    const paused = await run(def, "bc1qsimaddress");
    expect(paused.phase).toBe("awaiting_gate");
    expect(paused.pendingGate?.before).toBe("sanctions");
    const done = await runToCompletion(def, "bc1qsimaddress");
    expect(done.phase).toBe("completed");
    expect((done.outputs["transactions"] as { transactions: number }).transactions).toBe(3);
  });

  it("T-PLAY-009: PB-04 توثيق صفقة قبل حذفها — بلا بوابات (كتاب محلي بالكامل)", async () => {
    const def = must("PB-04");
    expect(def.gates).toHaveLength(0);
    const done = await run(def, "https://docs.example.test/page");
    expect(done.phase).toBe("completed");
    expect(done.completedSteps.map((s) => s.stepId)).toEqual(["warc", "wayback-history", "save-page-now"]);
    expect((done.outputs["warc"] as { sha256: string }).sha256).toBe("sim-warc-hash");
  });

  it("T-PLAY-010: PB-05 تحقق من صورة — البوابة قبل أي رفع خارجي (البحث العكسي)", async () => {
    const def = must("PB-05");
    const paused = await run(def, "aW1hZ2UtYmFzZTY0LXNpbQ==");
    expect(paused.phase).toBe("awaiting_gate");
    expect(paused.pendingGate?.before).toBe("reverse-search");
    expect(paused.completedSteps.map((s) => s.stepId)).toContain("exif");
    const done = await runToCompletion(def, "aW1hZ2UtYmFzZTY0LXNpbQ==");
    expect(done.phase).toBe("completed");
    expect((done.outputs["reverse-search"] as { manual: boolean }).manual).toBe(true);
  });

  it("T-PLAY-011: PB-06 تحقق من فيديو — البوابة قبل أي رفع خارجي", async () => {
    const def = must("PB-06");
    const paused = await run(def, "dmlkZW8tYmFzZTY0LXNpbQ==");
    expect(paused.phase).toBe("awaiting_gate");
    expect(paused.pendingGate?.before).toBe("reverse-search");
    const done = await runToCompletion(def, "dmlkZW8tYmFzZTY0LXNpbQ==");
    expect(done.phase).toBe("completed");
    expect((done.outputs["frames"] as { frames: number }).frames).toBe(4);
  });

  it("T-PLAY-012: PB-07 بنية تحتية لحملة تصيد (دفاعي) — بلا بوابات، يكتمل بالمرجع", async () => {
    const def = must("PB-07");
    expect(def.gates).toHaveLength(0);
    const done = await run(def, "phish.example.test");
    expect(done.phase).toBe("completed");
    expect(done.completedSteps.map((s) => s.stepId)).toEqual(["certs", "ip-rdap", "asn", "dns-history"]);
  });

  it("T-PLAY-013: PB-08 تتبع شبكة حسابات عامة لمؤسسة — الأشخاص الطبيعيون خارج النطاق إلا بغرض", async () => {
    const def = must("PB-08");
    expect(def.scope.natural_persons).toBe("requires_purpose");
    const done = await runToCompletion(def, "Sim Organization");
    expect(done.phase).toBe("completed");
    expect(done.completedSteps.map((s) => s.stepId)).toEqual(["github", "gitlab", "wayback-history"]);
  });

  it("T-PLAY-014: كل كتاب يرفض الشخص الطبيعي وفق نطاقه المعلن قبل أي استدعاء", async () => {
    for (const { def } of books) {
      const state = await executePlaybook(def, { canonicalInput: "2291363352", sensitivity: "natural_person_gate" }, { invoke: simInvoke });
      expect(state.phase, def.id).toBe("refused");
      expect(state.completedSteps, def.id).toHaveLength(0);
    }
  });

  it("T-PLAY-015: الحتمية — نفس الكتاب والمدخل يعطي نفس بصمة الحالة (المرجع مستقر)", async () => {
    for (const { def } of books) {
      const a = await runToCompletion(def, "sim-reference-input");
      const b = await runToCompletion(def, "sim-reference-input");
      expect(a.stateHash, def.id).toBe(b.stateHash);
    }
  });

  it("T-PLAY-016: كل خطوة في كل كتاب تشير إلى محوّل معتمد في سجل TR (لا معرّفات مختلقة)", () => {
    const known = new Set([
      "TR-001",
      "TR-002",
      "TR-003",
      "TR-004",
      "TR-006",
      "TR-008",
      "TR-011",
      "TR-012",
      "TR-013",
      "TR-014",
      "TR-015",
      "TR-016",
      "TR-017",
      "TR-021",
      "TR-022",
      "TR-025",
      "TR-031",
      "TR-032",
      "TR-033",
      "TR-035",
      "TR-048",
    ]);
    for (const { def } of books) {
      for (const step of def.steps) {
        expect(known.has(step.transform), `${def.id}/${step.id}: ${step.transform}`).toBe(true);
      }
    }
  });
});
