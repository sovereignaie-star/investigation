/**
 * P7-002 (stage 2): live evidence that a multi-arch image was built,
 * signed keyless, and verified — the roadmap acceptance. The evidence doc
 * must carry the real run id, the signed index digest, both platforms,
 * the signer identity, and the verification result.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const EVID = join(root, "docs/security/signed-images.md");

test("T-IMG-RUN-001: دليل تشغيل حقيقي موقّع ومتحقق منه", () => {
  assert.ok(existsSync(EVID), `${EVID} غير موجودة`);
  const md = readFileSync(EVID, "utf8");
  assert.ok(md.includes("P7-002"), "يحمل معرف المهمة P7-002");
  assert.ok(/run `?\d{8,}`?/.test(md), "معرف تشغيل حقيقي مفقود");
  assert.ok(/sha256:[0-9a-f]{12,}/.test(md), "digest الفهرس مفقود");
  assert.ok(md.includes("amd64") && md.includes("arm64"), "المعماريتان غير موثقتين");
  // anchored issuer check (CodeQL js/incomplete-hostname-regexp): the issuer
  // must appear in its full verification-command form, not as a bare host
  assert.ok(/--certificate-oidc-issuer https:\/\/token\.actions\.githubusercontent\.com/.test(md), "issuer هوية الموقّع غير موثق");
  assert.ok(md.includes("--certificate-identity"), "التحقق الصارم بالهوية غير موثق");
  assert.ok(/نجح التحقق|claims were validated/.test(md), "نتيجة التحقق غير موثقة");
});
