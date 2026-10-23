/**
 * P5-023 — قوالب تقارير إضافية: ملف كيان (Dossier)، تقرير خط زمني، تقرير مقارنة.
 *
 * كل قالب يُبنى فوق عقد @ir/reports القائم (ReportDocument عبر buildReport —
 * فاشل-مغلق: لا جملة بلا إحالة ولا إحالة معلقة) فيجتاز مدقق الإحالات P5-011
 * بحكم البناء، ويُصدَّر بالقوالب القائمة (HTML/DOCX/Markdown).
 */
import { auditReportDocument, buildReport, type EvidenceRef, type ReportDocument, type ReportSection } from "./index.ts";
import { z } from "zod";

const EvidenceRefSchema = z.object({
  id: z.string().regex(/^EV-[A-Za-z0-9-]+$/),
  label: z.string().min(1),
  sha256: z.string().length(64).optional(),
});

/** فاشل-مغلق: القالب يُقبل فقط إذا اجتاز مدقق الإحالات P5-011 (لا أدلة يتيمة ولا عبارات بلا إحالة ولا إحالات معلقة). */
function auditedOrThrow(doc: ReportDocument): ReportDocument {
  const audit = auditReportDocument(doc);
  if (!audit.ok) {
    throw new Error(`القالب ينتج تقريراً لا يجتاز مدقق الإحالات: ${audit.issues.map((i) => `${i.kind}(${i.detail})`).join("، ")}`);
  }
  return doc;
}

const StatementInputSchema = z.object({
  text: z.string().min(1),
  citations: z.array(EvidenceRefSchema).min(1, "جملة واقعية بلا إحالة — لا يُقبل القالب (UC-14)"),
});

/* ---------------------------------------------------- ملف الكيان (Dossier) */

export interface DossierInput {
  readonly entity: { readonly name: string; readonly kind: string };
  readonly caseRef: string;
  readonly lang: "ar" | "en";
  readonly evidence: readonly EvidenceRef[];
  readonly sections: readonly {
    readonly title: string;
    readonly statements: readonly { readonly text: string; readonly citations: readonly EvidenceRef[] }[];
  }[];
}

const DossierSchema = z.object({
  entity: z.object({ name: z.string().min(1), kind: z.string().min(1) }),
  caseRef: z.string().min(1),
  lang: z.enum(["ar", "en"]),
  evidence: z.array(EvidenceRefSchema).min(1),
  sections: z.array(z.object({ title: z.string().min(1), statements: z.array(StatementInputSchema).min(1) })).min(1),
});

/** ملف الكيان — تقرير عن كيان واحد باسمه في العنوان. */
export function buildDossierReport(input: DossierInput): ReportDocument {
  const parsed = DossierSchema.parse(input);
  const report = buildReport({
    title: parsed.lang === "ar" ? `ملف الكيان: ${parsed.entity.name}` : `Entity dossier: ${parsed.entity.name}`,
    caseRef: parsed.caseRef,
    lang: parsed.lang,
    sections: parsed.sections,
    evidence: parsed.evidence,
  });
  return auditedOrThrow(report);
}

/* ------------------------------------------------------ تقرير الخط الزمني */

export interface TimelineEvent {
  readonly at: string;
  readonly text: string;
  readonly citations: readonly EvidenceRef[];
}

export interface TimelineInput {
  readonly title: string;
  readonly caseRef: string;
  readonly lang: "ar" | "en";
  readonly evidence: readonly EvidenceRef[];
  readonly events: readonly TimelineEvent[];
}

const TimelineEventSchema = z.object({
  at: z
    .string()
    .min(1)
    .refine((v) => !Number.isNaN(Date.parse(v)), "طابع زمني غير صالح"),
  text: z.string().min(1),
  citations: z.array(EvidenceRefSchema).min(1, "حدث بلا إحالة — لا يُقبل القالب"),
});

const TimelineSchema = z.object({
  title: z.string().min(1),
  caseRef: z.string().min(1),
  lang: z.enum(["ar", "en"]),
  evidence: z.array(EvidenceRefSchema).min(1),
  events: z.array(TimelineEventSchema).min(1, "خط زمني بلا أحداث"),
});

/** تقرير الخط الزمني — الأحداث مرتبة زمنياً تصاعدياً وكل حدث بطابعه وإحالته. */
export function buildTimelineReport(input: TimelineInput): ReportDocument {
  const parsed = TimelineSchema.parse(input);
  const ordered = [...parsed.events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const events: ReportSection[] = ordered.map((event) => ({
    title: event.at,
    statements: [{ text: `${event.at} — ${event.text}`, citations: event.citations }],
  }));
  const report = buildReport({
    title: parsed.title,
    caseRef: parsed.caseRef,
    lang: parsed.lang,
    sections: events,
    evidence: parsed.evidence,
  });
  return auditedOrThrow(report);
}

/* ----------------------------------------------------- تقرير المقارنة */

export interface ComparisonInput {
  readonly title: string;
  readonly caseRef: string;
  readonly lang: "ar" | "en";
  readonly evidence: readonly EvidenceRef[];
  readonly subjects: readonly { readonly name: string }[];
  readonly aspects: readonly {
    readonly name: string;
    readonly statements: readonly { readonly subject: string; readonly text: string; readonly citations: readonly EvidenceRef[] }[];
  }[];
}

const ComparisonStatementSchema = z.object({
  subject: z.string().min(1),
  text: z.string().min(1),
  citations: z.array(EvidenceRefSchema).min(1, "عبارة مقارنة بلا إحالة — لا يُقبل القالب"),
});

const ComparisonSchema = z
  .object({
    title: z.string().min(1),
    caseRef: z.string().min(1),
    lang: z.enum(["ar", "en"]),
    evidence: z.array(EvidenceRefSchema).min(1),
    subjects: z.array(z.object({ name: z.string().min(1) })).min(2, "مقارنة بلا طرفين على الأقل"),
    aspects: z
      .array(
        z.object({
          name: z.string().min(1),
          statements: z.array(ComparisonStatementSchema).min(1),
        }),
      )
      .min(1),
  })
  .superRefine((input, ctx) => {
    const subjectNames = new Set(input.subjects.map((s) => s.name));
    for (const aspect of input.aspects) {
      for (const statement of aspect.statements) {
        if (!subjectNames.has(statement.subject)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["aspects"],
            message: `عبارة مقارنة تشير إلى طرف غير معلن: ${statement.subject}`,
          });
        }
      }
    }
  });

/** تقرير المقارنة — طرفان فأكثر، كل جانب بجمل لكل طرف معلن. */
export function buildComparisonReport(input: ComparisonInput): ReportDocument {
  const parsed = ComparisonSchema.parse(input);
  const sections: ReportSection[] = parsed.aspects.map((aspect) => ({
    title: aspect.name,
    statements: aspect.statements.map((statement) => ({
      text: `${statement.subject}: ${statement.text}`,
      citations: statement.citations,
    })),
  }));
  const report = buildReport({
    title: parsed.title,
    caseRef: parsed.caseRef,
    lang: parsed.lang,
    sections,
    evidence: parsed.evidence,
  });
  return auditedOrThrow(report);
}
