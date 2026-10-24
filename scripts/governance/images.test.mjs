/**
 * P7-002: signed multi-arch Docker images guard (T-IMG-001..002).
 *
 * The images workflow must build linux/amd64+linux/arm64, push to GHCR,
 * sign the multi-arch index digest with keyless cosign (GitHub OIDC), and
 * verify in-workflow against a strict certificate identity. The live-run
 * acceptance (signature verification succeeds) is guarded separately in
 * images-run.test.mjs once a real run exists (two-stage, like P7-001).
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
