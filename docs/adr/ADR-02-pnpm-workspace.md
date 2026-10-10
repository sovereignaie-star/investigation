# ADR-02: pnpm workspace مع `minimumReleaseAge`

| البند | القيمة |
|---|---|
| الحالة | مُقرّر بتفويض |
| التاريخ | 2026-10-10 |
| المرجع | `docs/ROADMAP.md` 5.20 |

## السياق

المستودع monorepo بتسع حزم، ومخاطر سلسلة التوريد (حزم خبيثة حديثة النشر) عالية (R-10).

## القرار

pnpm 10 workspace مع `minimumReleaseAge: 1440` (لا تُثبَّت نسخة عمرها أقل من يوم) في `pnpm-workspace.yaml`، وقفل `--frozen-lockfile` في CI.

## البدائل

npm/yarn workspaces (أبطأ ولا تملك `minimumReleaseAge`)؛ Bun (نضج أقل للأدوات التي نعتمدها).

## العواقب

حماية من هجمات النشر السريع؛ تأخير يوم في تبني الإصلاحات الطارئة، ويُستثنى عند الحاجة عبر `minimumReleaseAgeExclude` بقرار موثق.
