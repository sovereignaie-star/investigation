# سجلات القرار المعمارية (ADR)

الصيغة: السياق، القرار، البدائل، العواقب، الحالة (الخارطة 5.20). الجدول المرجعي لكل القرارات بحالاتها في `docs/ROADMAP.md` 5.20؛ القرارات «المقترحة» تُكتب ملفاتها مع مهامها.

| المعرّف | القرار | الحالة |
|---|---|---|
| [ADR-01](ADR-01-vite-react.md) | البقاء على Vite + React 19 بدل Next.js | مُقرّر بتفويض |
| [ADR-02](ADR-02-pnpm-workspace.md) | pnpm workspace مع `minimumReleaseAge` | مُقرّر بتفويض |
| [ADR-03](ADR-03-node-24.md) | Node 24 LTS هدفاً للتشغيل وCI | مُقرّر بتفويض |
| [ADR-04](ADR-04-case-storage.md) | قضية = مجلد: SQLite عبر `node:sqlite` + blobs؛ Postgres للفرق لاحقاً | مُقرّر بتفويض ومُنفّذ (P1-013) |
| [ADR-06](ADR-06-evidence-ledger.md) | سجل أدلة بسلسلة SHA-256 + JCS + Ed25519 | مُقرّر بتفويض ومُنفّذ (P1-009، P1-010، P1-011) |
| [ADR-10](ADR-10-license-agpl.md) | الترخيص: AGPL-3.0-or-later | مُقرّر بتفويض |
| [ADR-11](ADR-11-no-saas-before-ga.md) | لا SaaS متعدد المستأجرين قبل GA | مُقرّر بتفويض |
| [ADR-13](ADR-13-test-stack.md) | Vitest للوحدة، Playwright للـ E2E، fast-check للخصائص، Stryker للطفرات | مُقرّر بتفويض |
| [ADR-14](ADR-14-openapi-orval.md) | OpenAPI أولاً + Orval | مُقرّر بتفويض (قائم) |
| [ADR-19](ADR-19-governance.md) | الحوكمة: تحديث الخارطة والحالة جزء من كل إيداع | مُقرّر بتفويض (مُفعّل) |
| [ADR-20](ADR-20-legal-review.md) | مراجعة قانونية إلزامية قبل GA | مُقرّر بتفويض |
| [ADR-21](ADR-21-no-turborepo.md) | لا Turborepo/Nx الآن | مُقرّر بتفويض |
| [ADR-22](ADR-22-git-hooks.md) | الخطافات في `.githooks` بلا Husky | مُقرّر بتفويض |
| [ADR-23](ADR-23-no-telemetry.md) | لا قياس عن بعد ولا خدمات تحليلات خارجية افتراضياً | مُقرّر بتفويض |
| [ADR-25](ADR-25-unique-view-ids.md) | معرّفات العقد والحواف فريدة في مخزن العرض؛ `loadInvestigation` يرفض التكرار؛ الإضافة الجماعية للأحجام الكبيرة | مُقرّر بتفويض (P1-022) |
