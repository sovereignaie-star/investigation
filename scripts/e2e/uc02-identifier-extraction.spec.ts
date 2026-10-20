/**
 * P3-020 / UC-02 — «لصق نص حر واستخراج المعرّفات» (ROADMAP 3.6): the identifier extraction
 * journey through the real UI. The page runs the REAL extraction engine over the pasted
 * text (client-side @ir/core detect) and the classified identifiers appear with type,
 * confidence and selectability.
 */
import { expect, test } from "@playwright/test";

const TEXT = [
  "تواصل عبر someone@example.org من النطاق example.com",
  "والخادم 93.184.216.34 ومحفظة 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
].join(" ");

test("UC-02: pasting free text extracts and classifies identifiers", async ({ page }) => {
  await page.goto("/#/workbench");
  await page.locator("#search-text").fill(TEXT);
  await page.locator('form[data-testid="search-bar"] button[type="submit"]').click();

  const selector = page.getByTestId("identifier-selector");
  // the pasted email, domain, IPv4 and Bitcoin address all appear as classified rows
  await expect(selector).toContainText("someone@example.org");
  await expect(selector).toContainText("example.com");
  await expect(selector).toContainText("93.184.216.34");
  await expect(selector).toContainText("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa");

  // the selection counter starts at zero and follows the analyst's selection
  const counter = page.getByText(/محدد المعرّفات/);
  await expect(counter).toContainText("0");
  await page.locator('input[name="identifier:email_corporate:someone@example.org"]').check();
  await expect(counter).toContainText("1");
});

test("UC-02: each extracted identifier carries a type label and a confidence", async ({ page }) => {
  await page.goto("/#/workbench");
  await page.locator("#search-text").fill(TEXT);
  await page.locator('form[data-testid="search-bar"] button[type="submit"]').click();

  // the Bitcoin address row shows its Arabic type label and a percentage confidence
  // (the selector is virtualized, but with four identifiers every row is in the viewport)
  const row = page.locator("tr").filter({ hasText: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" }).first();
  await expect(row).toContainText("بيتكوين");
  await expect(row).toContainText("%");
});
