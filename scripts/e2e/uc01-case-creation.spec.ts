/**
 * P3-020 / UC-01 — «إنشاء قضية بغرض موثق» (ROADMAP 3.6): the case creation journey through
 * the real UI. The E-01 boundary is the acceptance's own core: a case without a stated
 * purpose is refused; the refusal surfaces honestly in the form.
 */
import { expect, test } from "@playwright/test";
import { adminToken } from "./helpers.ts";

const PURPOSE = "توسيع نطاق في بيئة المحاكاة للتحقق من رحلة إنشاء القضية كاملة";
const SHORT_PURPOSE = "قصير";

test("UC-01: creates a case with a documented purpose and lists it", async ({ page }) => {
  await page.goto("/#/cases");
  // cold session: the admin token lives in memory only (D-033/D-037) — the field saves
  // on change (P3-015's one-ref token)
  await page.locator("#admin-token").fill(adminToken);

  await page.locator("#case-title").fill("قضية اختبار E2E");
  await page.locator("#case-purpose").fill(PURPOSE);
  // the legal basis is a required field of the same contract the API enforces
  await page.locator("#case-legal-basis").click();
  await page.getByRole("option", { name: /due_diligence/ }).click();
  await page.getByTestId("create-case-submit").click();

  // the honest success state names what was created
  await expect(page.getByTestId("create-case-status")).toContainText("قضية اختبار E2E");
  // and the case appears in the table
  await expect(page.getByTestId("cases-table")).toContainText("قضية اختبار E2E");
});

test("UC-01: refuses a case without a real purpose (E-01 fail-closed)", async ({ page }) => {
  await page.goto("/#/cases");
  await page.locator("#admin-token").fill(adminToken);

  await page.locator("#case-title").fill("قضية يجب ألا تنشأ");
  await page.locator("#case-purpose").fill(SHORT_PURPOSE);
  await page.locator("#case-legal-basis").click();
  await page.getByRole("option", { name: /due_diligence/ }).click();
  await page.getByTestId("create-case-submit").click();

  // the API's refusal surfaces verbatim in the form — no silent fallback
  await expect(page.getByTestId("create-case-error")).toContainText("invalid case input");
  // and the rejected case left nothing behind (E-01: a rejected case creates no files)
  await expect(page.getByTestId("cases-table")).not.toContainText("قضية يجب ألا تنشأ");
});
