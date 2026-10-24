# الصور الموقعة متعددة المعماريات (P7-002)

> سطر الصور: `.github/workflows/images.yml` — وسم `v*` (أو تشغيل يدوي للتجربة) يبني `linux/amd64` + `linux/arm64`، يدفع إلى GHCR، يوقّع digest الفهرس بcosign بدون مفاتيح (OIDC)، ثم يتحقق داخل الworkflow نفسه بهوية صارمة.

## التشغيل التجريبي (قبول المهمة) — 2026-10-24

- **التشغيل:** run `40122224762` (workflow_dispatch على main@a938900) — نجح كاملاً (بناء + دفع + توقيع + تحقق).
- **الوسم التجريبي:** `ghcr.io/sovereignaie-star/investigation:trial-a938900` (مرتبط بالSHA، لا يمس وسوم الإصدارات ولا latest).
- **digest الفهرس (المُوقَّع والمُتحقق منه):** `sha256:cadefdcafb21c1533f56bd8875dd9cf6122cf356586eeb823bea8dd8bcdaa3e0`
- **المعماريتان في الفهرس (imagetools inspect):** `linux/amd64` (manifest `sha256:46348757…`) و`linux/arm64` (manifest `sha256:d9c8323b…`) + manifest إثبات provenance.
- **التوقيع:** cosign v2.5.2 بدون مفاتيح — مفاتيح سريعة الزوال عبر OIDC، إدخال سجل الشفافية `tlog entry created with index: 3441619836`.
- **هوية الموقّع (التحقق الصارم):** `--certificate-identity "https://github.com/sovereignaie-star/investigation/.github/workflows/images.yml@refs/heads/main"` مع `--certificate-oidc-issuer https://token.actions.githubusercontent.com`.
- **نتيجة التحقق:** نجح التحقق — «Verification for ghcr.io/…@sha256:cadefdca…» و«The cosign claims were validated» و«Existence of the claims in the transparency log was verified offline».
- **العمومية:** الحزمة عامة على GHCR — سحب مجهول الهوية يعمل (فُحص بجلب قائمة الوسوم بلا مصادقة) والتوقيع متاح للعموم (`sha256-cadefdca….sig`).

## ما قبل النجاح (أحمر موثق)

1. التشغيل `40117018962`: فشل بناء arm64 — `pnpm run build` في الجذر يبني apps/sandbox (lightningcss) — أُصلح بتصفية البناء على ما تشحنه الصورة فقط (server/web/cli وتبعياتها).
2. التشغيل `40119189792`: فشل — رابط lightningcss-linux-arm64-gnu معطل في تجاوزات pnpm-workspace.yaml.
3. التشغيل `40120676547`: فشل — روابط @tailwindcss/oxide وesbuild وrollup لarm64 معطلة كذلك. أُصلح بإعادة تفعيل روابط linux-arm64 (PRs #425 و#426 و#427).

## الاستخدام

```bash
docker run -p 8080:8080 ghcr.io/sovereignaie-star/investigation:vX.Y.Z
cosign verify \
  --certificate-identity "https://github.com/sovereignaie-star/investigation/.github/workflows/images.yml@refs/tags/vX.Y.Z" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/sovereignaie-star/investigation@sha256:<digest>
```

كل وسم `v*` مستقبلاً يمر بنفس الخط: بناء موقّع متحقق منه داخل الworkflow (الخطوة «Verify the signature» تفشل البناء إن لم يصمد التوقيع).
