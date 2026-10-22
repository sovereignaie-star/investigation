import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { manualClock, ulidFactory } from "@ir/core";
import { generateInstallationKey, merkleRoot, verify } from "@ir/ledger";
import { LATEST_VERSION, openCase, verifyCase } from "./index.ts";
import { buildIrpack, IRPACK_FORMAT, packCase, parseIrpack, unpackCase, type IrpackManifest } from "./pack.ts";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "ir-pack-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const CREATE = { title: "قضية اختبار", purpose: "تحقق قانوني لنطاق", legalBasis: "due_diligence" } as const;
const clock = () => manualClock("2026-10-22T09:00:00.000Z");
const key = generateInstallationKey();

/** A plain or encrypted case with evidence, an observation and a note. */
const seededCase = (encrypted?: string) => {
  const dir = tmp();
  const c = clock();
  const a = openCase(dir, {
    actor: "analyst",
    clock: c,
    create: CREATE,
    ...(encrypted ? { passphrase: encrypted } : {}),
  });
  const ev = a.addEvidence(
    {
      bytes: new TextEncoder().encode('{"ns":["a.iana-servers.net"]}'),
      mime: "application/json",
      request: { method: "DNS", url: "dns:example.com/NS" },
      transformId: "tr-dns",
      version: "1.0.0",
    },
    { newId: ulidFactory(c) },
  );
  a.ledger.append("observation.added", { evidence: ev.id, value: "a.iana-servers.net" });
  a.ledger.append("note.added", { text: "ملاحظة أولى" });
  const projection = a.projection();
  const entries = a.ledger.entries();
  const info = a.info();
  const audit = a.auditTrail();
  a.close();
  return { dir, ev, projection, entries, info, audit };
};

/** Pack → parse → edit the manifest → rebuild with a valid re-signature (for refusal tests). */
const reSign = (bytes: Uint8Array, changes: Partial<IrpackManifest>, k: ReturnType<typeof generateInstallationKey>): Uint8Array => {
  const { manifest, files } = parseIrpack(bytes);
  const edited: Partial<IrpackManifest> = { ...manifest, ...changes };
  delete edited.signature;
  const signed = { ...edited, signature: k.sign(new TextEncoder().encode(JSON.stringify(edited))) };
  return buildIrpack(files, signed as IrpackManifest);
};

describe("P4-016 — حزمة القضية الموقعة .irpack (T-IO-006 التوقيع والتجزئات)", () => {
  it("دورة كاملة بلا فقد: الحزمة تعيد بناء القضية والتحقق أخضر والمسقط مطابق", () => {
    const src = seededCase();
    const bytes = packCase(src.dir, { actor: "analyst", clock: clock(), key });
    const dest = tmp();
    unpackCase(bytes, dest, {});

    const b = openCase(dest, { actor: "analyst", clock: clock() });
    expect(b.ledger.entries()).toEqual(src.entries); // السلسلة نفسها حرفياً
    expect(b.projection()).toEqual(src.projection); // المسقط نفسه (projectionHash)
    expect(b.info()).toEqual(src.info); // سجل القضية نفسه
    expect(b.auditTrail()).toEqual(src.audit); // سجل التدقيق كاملاً
    expect(b.blobs.get(src.ev.sha256)).toEqual(new TextEncoder().encode('{"ns":["a.iana-servers.net"]}')); // الدليل ببايتاته
    expect(b.db.prepare("SELECT id, ledger_seq FROM evidence").all()).toEqual([{ id: src.ev.id, ledger_seq: 2 }]);
    b.close();

    const report = verifyCase(dest, { publicKeyPem: key.publicKeyPem });
    expect(report.ok).toBe(true);
    expect(report.chain.head).toBe(src.entries[src.entries.length - 1]?.entryHash);
  });

  it("الحزمة حتمية: نفس القضية والمفتاح والساعة تنتج بايتات متطابقة", () => {
    const src = seededCase();
    const a = packCase(src.dir, { actor: "analyst", clock: clock(), key });
    const b = packCase(src.dir, { actor: "analyst", clock: clock(), key });
    expect(a).toEqual(b);
  });

  it("القضية المشفرة: الحمولات المختومة تُحفظ كما هي وتُفتح الحزمة بعبارة المرور", () => {
    const src = seededCase("سر-قضية-١");
    const bytes = packCase(src.dir, { actor: "analyst", clock: clock(), key, passphrase: "سر-قضية-١" });
    const dest = tmp();
    unpackCase(bytes, dest, { passphrase: "سر-قضية-١" });

    const b = openCase(dest, { actor: "analyst", clock: clock(), readOnly: true, passphrase: "سر-قضية-١" });
    expect(b.ledger.entries()).toEqual(src.entries); // الحمولات المختومة دون تغيير
    expect(b.blobs.get(src.ev.sha256)).toEqual(new TextEncoder().encode('{"ns":["a.iana-servers.net"]}'));
    b.close();
    expect(verifyCase(dest, { publicKeyPem: key.publicKeyPem, passphrase: "سر-قضية-١" }).ok).toBe(true);
  });

  it("T-IO-006: تلاعب بأي جزء يُرفض فشلاً-مغلقاً — تجزئة كل ملف والتوقيع على البيان", () => {
    const src = seededCase();
    const bytes = packCase(src.dir, { actor: "analyst", clock: clock(), key });
    expect(() => unpackCase(bytes, tmp(), {})).not.toThrow(); // baseline

    // 1) بت واحد في chain.ndjson → تجزئة الملف تكشف
    const { files } = parseIrpack(bytes);
    const chain = new Uint8Array(files.get("chain.ndjson") ?? new Uint8Array());
    chain[chain.length - 5] ^= 0x01;
    const tampered = new Map(files);
    tampered.set("chain.ndjson", chain);
    expect(() => unpackCase(buildIrpack(tampered, parseIrpack(bytes).manifest), tmp(), {})).toThrow(/hash mismatch|digest/);

    // 2) بت في كتلة دليل → تجزئة الملف تكشف
    const blobName = [...files.keys()].find((n) => n.startsWith("blobs/"));
    expect(blobName).toBeDefined();
    const blob = new Uint8Array(files.get(blobName ?? "") ?? new Uint8Array());
    blob[0] ^= 0x01;
    const tamperedBlob = new Map(files);
    tamperedBlob.set(blobName ?? "", blob);
    expect(() => unpackCase(buildIrpack(tamperedBlob, parseIrpack(bytes).manifest), tmp(), {})).toThrow(/hash mismatch|digest/);

    // 3) حقل في البيان بلا إعادة توقيع → التوقيع يكشف
    const m = parseIrpack(bytes).manifest;
    const forged = { ...m, case: { ...m.case, title: "قضية مفبركة" } };
    expect(() => unpackCase(buildIrpack(files, forged), tmp(), {})).toThrow(/signature|توقيع/);
  });

  it("التثبيت: keyId مختلف يُرفض والحزمة السليمة تُقبل", () => {
    const src = seededCase();
    const bytes = packCase(src.dir, { actor: "analyst", clock: clock(), key });
    const other = generateInstallationKey();
    expect(() => unpackCase(bytes, tmp(), { expectedKeyId: other.keyId })).toThrow();
    expect(() => unpackCase(bytes, tmp(), { expectedKeyId: key.keyId })).not.toThrow();
  });

  it("NFR-18: صيغة أحدث أو بناء أحدث يُرفض صراحة", () => {
    const src = seededCase();
    const bytes = packCase(src.dir, { actor: "analyst", clock: clock(), key });
    expect(() => unpackCase(reSign(bytes, { format: "irpack/2" }, key), tmp(), {})).toThrow(/format|صيغة/);
    expect(() => unpackCase(reSign(bytes, { schemaVersion: LATEST_VERSION + 1 }, key), tmp(), {})).toThrow(/schema|بناء/);
  });

  it("ملف زائد أو ناقص في الحزمة يُرفض، والاستيراد فوق دليل غير فارغ يُرفض", () => {
    const src = seededCase();
    const bytes = packCase(src.dir, { actor: "analyst", clock: clock(), key });
    const parsed = parseIrpack(bytes);

    // ناقص: كتلة دليل محذوفة من الحزمة (البيان ما زال يذكرها)
    const dropped = new Map(parsed.files);
    const blobName = [...dropped.keys()].find((n) => n.startsWith("blobs/"));
    dropped.delete(blobName ?? "");
    expect(() => unpackCase(buildIrpack(dropped, parsed.manifest), tmp(), {})).toThrow();

    // زائد: ملف غير مصرح به داخل الحزمة يُرفض (تطابق الأسماء مع البيان)
    const extra = new Map(parsed.files);
    extra.set("extra.txt", new TextEncoder().encode("x"));
    expect(() => unpackCase(buildIrpack(extra, parsed.manifest), tmp(), {})).toThrow();

    // دليل غير فارغ: يُرفض ولا يمس ما فيه
    const dest = tmp();
    writeFileSync(path.join(dest, "موجود.txt"), "بقاء");
    expect(() => unpackCase(bytes, dest, {})).toThrow();
    expect(readFileSync(path.join(dest, "موجود.txt"), "utf8")).toBe("بقاء");
  });

  it("قضية مقفلة تُرفض رسالةً واضحة (فشل-مغلق)", () => {
    const src = seededCase("سر-قضية-مقفلة");
    expect(() => packCase(src.dir, { actor: "analyst", clock: clock(), key })).toThrow(/locked|مقفلة/);
  });

  it("البيان يلتزم السلسلة: head وmerkleRoot وschemaVersion في البيان يطابقون القضية", () => {
    const src = seededCase();
    const bytes = packCase(src.dir, { actor: "analyst", clock: clock(), key });
    const m = parseIrpack(bytes).manifest;
    expect(m.format).toBe(IRPACK_FORMAT);
    expect(m.chain.length).toBe(src.entries.length);
    expect(m.chain.head).toBe(src.entries[src.entries.length - 1]?.entryHash);
    expect(m.chain.merkleRoot).toBe(merkleRoot(src.entries.map((e) => e.entryHash)));
    expect(m.keyId).toBe(key.keyId);
    expect(verify(src.entries).ok).toBe(true);
  });
});
