# packages/

حزم المجال (`@ir/*`) حسب القسم 5.3 من [`docs/ROADMAP.md`](../docs/ROADMAP.md). كل حزمة:

- مجلد `packages/<name>` باسم `@ir/<name>` و`"private": true` و`"type": "module"`.
- `tsconfig.json` يمتد من `../../tsconfig.base.json`، ونص `typecheck` (يُلتقط آلياً في `pnpm run typecheck`).
- اختبارات `*.test.ts` بجانب الكود (تُلتقط آلياً في `pnpm test`).
- النواة (`schema`، `core`، `ledger`) نقية: لا شبكة ولا تخزين ولا واجهة (5.2).
