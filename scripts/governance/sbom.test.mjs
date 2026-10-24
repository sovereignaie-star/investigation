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
  assert.ok(y.includes("cosign download sbom"), "خطوة تنزيل SBOM مفقودة");
  assert.ok(y.includes("cosign verify-attestation"), "خطوة التحقق من provenance مفقودة");
  assert.ok(y.includes("slsaprovenance"), "نوع attestation غير مثبت");
  assert.ok(y.includes("--certificate-identity"), "التحقق الصارم بالهوية مفقود");
  assert.ok(y.includes("--certificate-oidc-issuer https://token.actions.githubusercontent.com"), "issuer غير مثبت");
  // the SBOM file must be attached to the v* GitHub release
  assert.ok(/gh release upload/.test(y), "رفع ملف SBOM إلى الإصدار مفقود");
});
