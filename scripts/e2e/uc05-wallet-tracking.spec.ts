/**
 * P3-020 / UC-05 — «تتبع عنوان محفظة عملة» (ROADMAP 3.6): the wallet tracking journey on
 * the simulation world. The engine side runs the REAL CLI: TR-016 on mempool.space — the
 * address's balance/transaction count and its OWN transactions with their counterparties
 * («معاملات وعناوين مرتبطة» is the journey's output). The browser side opens the case
 * and asserts the output; the checksum refusal (the UC's acceptance: يُتحقق من صيغة العنوان
 * (checksum) قبل الجلب) is asserted through the CLI's subject gate.
 */
import path from "node:path";
import { expect, test } from "@playwright/test";
import { caseDirOf, createCaseViaApi, fixturesDir, irRun, openCase } from "./helpers.ts";

const SIM = path.join(fixturesDir, "uc05-sim.json");

test("UC-05: a wallet address tracks to transactions and related addresses with chain notes", async ({ page }) => {
  const caseId = await createCaseViaApi(
    "قضية تتبع محفظة",
    "تتبع عنوان محفظة في بيئة المحاكاة للتحقق من المعاملات والعناوين المرتبطة كاملة",
  );
  const dir = caseDirOf(caseId);

  // the REAL engine path on the simulation world: one run, one address
  const out = irRun(dir, "TR-016", "bitcoin_address", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", SIM);
  expect(out).toContain("has_balance");
  expect(out).toContain("has_transaction");
  expect(out).toContain("transacted_with");

  await openCase(page, caseId);

  // the wallet, its counterparty and the transaction hashes are in the case's projection
  const filter = page.getByTestId("entity-filter");
  for (const value of [
    "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
    "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
    "f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16",
  ]) {
    await filter.fill(value);
    await expect(page.getByTestId("entity-table")).toContainText(value);
  }

  // the wallet node's relations carry the chain notes: the balance, the transactions and
  // the related address — each with its source note and openable evidence
  await filter.fill("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa");
  await page.getByTestId("entity-row").filter({ hasText: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" }).first().click();
  const detail = page.getByTestId("node-detail-panel");
  await expect(detail).toContainText("has_balance");
  await expect(detail).toContainText("has_transaction");
  await expect(detail).toContainText("transacted_with");
  await expect(detail).toContainText("mempool.space");
  expect(await page.getByTestId("relation-source-note").count()).toBeGreaterThan(0);
  expect(await page.getByTestId("evidence-link").count()).toBeGreaterThan(0);
});

test("UC-05 acceptance: a well-formed address with a wrong checksum is refused before any fetch", async () => {
  const caseId = await createCaseViaApi("قضية رفض checksum", "التحقق من رفض عنوان محفظة صحيح الشكل بchecksum خاطئ قبل أي جلب");
  const dir = caseDirOf(caseId);
  // the CLI's subject gate refuses it before opening the case (exit 2, checksum in the refusal)
  let refused = false;
  try {
    irRun(dir, "TR-016", "bitcoin_address", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb", SIM);
  } catch (x) {
    refused = true;
    const err = x as { stderr?: string; message?: string };
    expect(`${err.stderr ?? ""} ${err.message ?? ""}`).toContain("checksum");
  }
  expect(refused).toBe(true);
});
