# كتيب: الإصدار (P7-006)

> خط الإصدار (P7-001): semver + changesets + وسم v* يشغّل release.yml الذي ينشئ إصدار GitHub بملاحظات من CHANGELOG.md.

## متى يُستخدم

- إصدار جديد (تصحيحي/وظيفي) بعد دمج الميزات على main.
- فشل تشغيل workflow الإصدار على وسم (حادثة إصدار).

## الخطوات

1. أضف changeset للميزة المدمجة (`pnpm changeset`) — تصف ماذا وأي نوع semver.
2. ادمج، ثم على main: `node scripts/release/notes.mjs <vX.Y.Z>` لمعاينة الملاحظات، `node scripts/release/tag.mjs --create` لإنشاء الوسم، `git push origin <tag>`.
3. انتظر release.yml (يستخرج الملاحظات وينشئ الإصدار عبر `gh release create`).
4. عند الفشل: حلل `gh run view <id> --log-failed`، أصلح بPR، ثم احذف الوسم (`git push origin :refs/tags/<tag>` + `git tag -d <tag>`) وأعد إنشاءه على الرأس المصحح — إعادة الوسم على نفس المحتوى تكفي.

## التحقق

- `gh release view <tag>` يعيد الاسم والرابط، والملاحظات مطابقة لما انتجه `notes.mjs`.
- قبول P7-001 تحقق تاريخياً: التشغيل `40108453156` (v0.1.0) أنشأ https://github.com/sovereignaie-star/investigation/releases/tag/v0.1.0 في 25 ثانية.

## التصعيد

- فشل الإصدار مرتين متتاليتين بنفس السبب بعد إصلاح => سجّل حادثة (incident-response.md) وشرّح درس الفشل في كتيب الإصدار نفسه (نمط ما-بعد-الحادث).
- إصدار أمني عاجل => dependency-vulnerability.md + تقييم الإفصاح (P7-007).
