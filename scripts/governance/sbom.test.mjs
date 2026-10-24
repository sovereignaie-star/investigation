/**
 * P7-003: SBOM (CycloneDX) and SLSA provenance guard (T-SBOM-001..002).
 *
 * Every released image must carry an SBOM attestation and SLSA provenance,
 * both verifiable, and the SBOM file must be attached to the GitHub
 * release. The live-run acceptance is guarded in sbom-run.test.mjs (stage 2).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const WF = join(root, ".github/workflows/images.yml");

function wf() {
  assert.ok(existsSync(WF), `${WF} غير موجودة`);
  return readFileSync(WF, "utf8");
}

test("T-SBOM-001: البناء يثبت SBOM وprovenance معاً", () => {
  const y = wf();
  assert.ok(y.includes("P7-003"), "يحمل معرف المهمة P7-003");
  assert.ok(/sbom:\s*true/.test(y), "إثبات SBOM مفقود");
  assert.ok(/provenance:\s*true/.test(y), "إثبات provenance مفقود");
});

test("T-SBOM-002: تحقق قابل للقياس وربط بالإصدار", () => {
  const y = wf();
  assert.ok(y.includes("cosign download attestation"), "خطوة تنزيل إثبات SBOM مفقودة");
  assert.ok(y.includes("cosign verify-attestation"), "خطوة التحقق من provenance مفقودة");
  assert.ok(y.includes("slsa.dev/provenance"), "نوع provenance غير مثبت");
  assert.ok(y.includes("cosign attest"), "إرفاق SBOM بcosign attest مفقود");
  assert.ok(y.includes("syft"), "توليد CycloneDX مفقود");
  assert.ok(y.includes("--certificate-identity"), "التحقق الصارم بالهوية مفقود");
  assert.ok(y.includes("--certificate-oidc-issuer https://token.actions.githubusercontent.com"), "issuer غير مثبت");
  // the SBOM file must be attached to the v* GitHub release
  assert.ok(/gh release upload/.test(y), "رفع ملف SBOM إلى الإصدار مفقود");
});

test("T-SBOM-003: مسح provenance يتبع تحويلات GHCR وملف الإصدار مطابق للمولد (2026-10-24)", () => {
  const y = readFileSync(".github/workflows/images.yml", "utf8");
  assert.ok(
    /curl -sSL --retry 3 --retry-delay 5 -H "Authorization: Bearer \${TOKEN}" "https:\/\/ghcr\.io\/v2\/\$\{GITHUB_REPOSITORY\}\/blobs\/\$\{layer\}"/.test(
      y,
    ),
    "جلب blob بلا -L (تحويل 307 إلى CDN يفسد المسح)",
  );
  assert.ok(!y.includes("sbom.spdx.json"), "الإصدار يرفع ملفاً غير مولد (sbom.spdx.json)");
  assert.ok(y.includes('gh release upload "${GITHUB_REF_NAME}" sbom.cdx.json'), "رفع sbom.cdx.json للإصدار مفقود");
});
