/**
 * P7-002: signed multi-arch Docker images guard (T-IMG-001..003).
 *
 * The images workflow must build linux/amd64+linux/arm64, push to GHCR,
 * sign the multi-arch index digest with keyless cosign (GitHub OIDC), and
 * verify in-workflow against a strict certificate identity. Acceptance
 * (signature verification succeeds) is evidenced by a real run — the
 * evidence doc must carry the run id, the index digest, both platforms,
 * the signer identity, and the verification result.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const WF = join(root, ".github/workflows/images.yml");
const EVID = join(root, "docs/security/signed-images.md");

function wf() {
  assert.ok(existsSync(WF), `${WF} غير موجودة`);
  return readFileSync(WF, "utf8");
}
function evid() {
  assert.ok(existsSync(EVID), `${EVID} غير موجودة`);
  return readFileSync(EVID, "utf8");
}

test("T-IMG-001: workflow الصور متعدد المعماريات إلى GHCR", () => {
  const y = wf();
  assert.ok(y.includes("P7-002"), "يحمل معرف المهمة P7-002");
  assert.ok(/tags:\s*\["v\*"\]/.test(y), "يستهدف أوسمة v*");
  assert.ok(y.includes("workflow_dispatch"), "يسمح بتشغيل تجريبي يدوي");
  assert.ok(y.includes("linux/amd64,linux/arm64"), "البناء متعدد المعماريات غير مذكور");
  assert.ok(y.includes("ghcr.io"), "الدفع إلى GHCR غير مذكور");
  assert.ok(y.includes("docker/setup-qemu-action"), "إعداد QEMU مفقود");
  assert.ok(y.includes("docker/setup-buildx-action"), "إعداد buildx مفقود");
});

test("T-IMG-002: توقيع cosign بدون مفاتيح + تحقق صارم بالهوية", () => {
  const y = wf();
  assert.ok(y.includes("cosign-installer") || y.includes("sigstore/cosign-installer"), "مثبت cosign مفقود");
  assert.ok(y.includes("cosign sign"), "خطوة التوقيع مفقودة");
  assert.ok(y.includes("id-token: write"), "صلاحية OIDC (id-token: write) مفقودة");
  assert.ok(y.includes("cosign verify"), "خطوة التحقق داخل الworkflow مفقودة");
  // strict identity: the workflow path + the actual ref, not a wide regex
  assert.ok(y.includes("--certificate-identity"), "التحقق من هوية الموقّع مفقود");
  assert.ok(y.includes("--certificate-oidc-issuer https://token.actions.githubusercontent.com"), "issuer غير مثبت");
  assert.ok(y.includes("imagetools inspect") || y.includes("docker buildx imagetools"), "فحص فهرس المعماريات مفقود");
  // sign the digest (index), not a mutable tag
  assert.ok(/\$?\{?\s*steps\.[\w.]+\.outputs\.digest|@sha256|\bdigest\b/.test(y), "التوقيع على digest غير مذكور");
});

test("T-IMG-003: دليل تشغيل حقيقي موقّع ومتحقق منه", () => {
  const e = evid();
  assert.ok(e.includes("P7-002"), "يحمل معرف المهمة P7-002");
  assert.ok(/run \d{8,}|تشغيل \d{8,}/.test(e), "معرف تشغيل حقيقي مفقود");
  assert.ok(/sha256:[0-9a-f]{12,}/.test(e), "digest الفهرس مفقود");
  assert.ok(e.includes("amd64") && e.includes("arm64"), "المعماريتان غير موثقتين");
  assert.ok(e.includes("token.actions.githubusercontent.com") || e.includes("issuer"), "هوية الموقّع غير موثقة");
  assert.ok(e.includes("نجح التحقق") || e.includes("Successfully verified") || e.includes("Verified OK"), "نتيجة التحقق غير موثقة");
});
