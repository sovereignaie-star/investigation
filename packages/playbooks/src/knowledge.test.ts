import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { loadPlaybook } from "./index.ts";

/**
 * P5-009 — استخراج المعرفة من ملفات بايثون إلى YAML بعد التنقية — T-KNW-001..007.
 *
 * المعرفة المستخرجة من `attached_assets/legacy/` (لا تُستورد في أي كود — قيمتها
 * معرفية): كل بند مصنف «مقبول/خارج الحدود» بسبب موثق، والمقبول المرتبط بكتاب
 * إجراءات يشير إلى كتاب قائم، والجرد يغطي كل الأصول الثلاثة عشر بلا تكرار.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const KNOWLEDGE_DIR = path.join(ROOT, "knowledge");
const LEGACY_DIR = path.join(ROOT, "attached_assets", "legacy");

const KnowledgeItemSchema = z.object({
  id: z.string().regex(/^KN-\d{3}$/),
  title: z.string().min(1),
  description: z.string().min(1),
  classification: z.enum(["مقبول", "خارج الحدود"]),
  reason: z.string().min(1),
  playbook: z
    .string()
    .regex(/^PB-\d{2}$/)
    .optional(),
});
const KnowledgeFileSchema = z.object({
  source: z.object({
    file: z.string().min(1),
    sha256: z.string().length(64),
  }),
  items: z.array(KnowledgeItemSchema).min(1),
});

const knowledgeFiles = existsSync(KNOWLEDGE_DIR)
  ? readdirSync(KNOWLEDGE_DIR)
      .filter((f) => f.endsWith(".yaml"))
      .sort()
  : [];
const documents = knowledgeFiles.map((f) => ({
  file: f,
  doc: KnowledgeFileSchema.parse(parseYaml(readFileSync(path.join(KNOWLEDGE_DIR, f), "utf8"))),
}));
const allItems = documents.flatMap((d) => d.doc.items);

const manifest = existsSync(path.join(LEGACY_DIR, "MANIFEST.md"))
  ? Object.fromEntries(
      readdirSync(LEGACY_DIR)
        .filter((f) => f.endsWith(".py"))
        .map((f) => [
          f,
          createHash("sha256")
            .update(readFileSync(path.join(LEGACY_DIR, f)))
            .digest("hex"),
        ]),
    )
  : {};

const bookFiles = existsSync(path.join(ROOT, "playbooks"))
  ? readdirSync(path.join(ROOT, "playbooks")).filter((f) => f.endsWith(".yaml"))
  : [];
const bookIds = new Set(bookFiles.map((f) => loadPlaybook(readFileSync(path.join(ROOT, "playbooks", f), "utf8")).id));

describe("P5-009 — استخراج المعرفة إلى YAML بعد التنقية", () => {
  it("T-KNW-001: المعرفة موجودة ومخططة — ملفات knowledge/*.yaml بمعرفات فريدة", () => {
    expect(documents.length).toBeGreaterThan(0);
    const ids = allItems.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("T-KNW-002: كل بند مصنف «مقبول/خارج الحدود» بسبب موثق — لا بند بلا تصنيف", () => {
    for (const item of allItems) {
      expect(["مقبول", "خارج الحدود"], item.id).toContain(item.classification);
      expect(item.reason.length, item.id).toBeGreaterThan(3);
    }
  });

  it("T-KNW-003: المقبول المرتبط بكتاب إجراءات يشير إلى كتاب قائم (لا معرّف مختلق)", () => {
    for (const item of allItems) {
      if (item.classification === "مقبول" && item.playbook !== undefined) {
        expect(bookIds.has(item.playbook), `${item.id}: ${item.playbook}`).toBe(true);
      }
    }
  });

  it("T-KNW-004: خارج الحدود لا يرتبط بأي كتاب — حد المنتج مُعلن في سببه", () => {
    for (const item of allItems) {
      if (item.classification === "خارج الحدود") {
        expect(item.playbook, item.id).toBeUndefined();
      }
    }
  });

  it("T-KNW-005: مصدر كل ملف معرفة حقيقي — الاسم والبصمة يطابقان الأصل بلا تعديل", () => {
    for (const { doc } of documents) {
      expect(manifest[doc.source.file], doc.source.file).toBeDefined();
      expect(doc.source.sha256).toBe(manifest[doc.source.file]);
    }
  });

  it("T-KNW-006: لا تكرار — عناوين البنود فريدة بعد التنقية عبر كل المصادر", () => {
    const titles = allItems.map((i) => i.title.trim());
    expect(new Set(titles).size, "duplicate titles after dedup").toBe(titles.length);
  });

  it("T-KNW-007: التغطية — كل الأصول الثلاثة عشر مغطاة في جرد المعرفة (مستخرجة أو موثقة)", () => {
    const legacyFiles = Object.keys(manifest);
    expect(legacyFiles.length).toBe(13);
    const covered = new Set(documents.map((d) => d.doc.source.file));
    for (const f of legacyFiles) {
      // ملف غير مستخرج منه بنود يُغطى بتوثيق صريح في جرد المعرفة (ملف استثناء)
      const exemptFiles = readExemptList();
      expect(covered.has(f) || exemptFiles.has(f), `${f} covered`).toBe(true);
    }
  });
});

/** ملفات بلا معرفة قابلة للاستخراج — تُوثق صراحة في جرد المعرفة لا أن تُختفى. */
function readExemptList(): Set<string> {
  const exemptPath = path.join(KNOWLEDGE_DIR, "EXEMPT.md");
  if (!existsSync(exemptPath)) return new Set();
  const content = readFileSync(exemptPath, "utf8");
  const files = new Set<string>();
  for (const m of content.matchAll(/^\| `([^`]+)` \|/gm)) files.add(m[1]);
  return files;
}
