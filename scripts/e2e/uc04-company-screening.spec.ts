/**
 * P3-020 / UC-04 — «فحص شركة في السجلات المفتوحة ومطابقة العقوبات» (ROADMAP 3.6): the
 * company screening journey on the simulation world. The engine side runs the REAL CLI:
 * TR-021 (GLEIF — the open registry record of the LEI) and TR-025 (OpenSanctions scored
 * match). The browser side opens the case and asserts the journey's output: the registry
 * entity, and the sanctions match carrying its score AND its reasons — «لا تعرض أي تطابق
 * عقوبات بلا درجة وأسباب» is the acceptance.
 */
import path from "node:path";
import { expect, test } from "@playwright/test";
import { caseDirOf, createCaseViaApi, fixturesDir, irRun, openCase } from "./helpers.ts";

const SIM = path.join(fixturesDir, "uc04-sim.json");

test("UC-04: a company screening shows the registry record and a scored, reasoned sanctions match", async ({ page }) => {
  const caseId = await createCaseViaApi(
    "قضية فحص شركة",
    "فحص شركة في السجلات المفتوحة ومطابقة العقوبات في بيئة المحاكاة للتحقق من الرحلة كاملة",
  );
  const dir = caseDirOf(caseId);

  // the REAL engine path on the simulation world: the open registry (GLEIF, by LEI) and the
  // scored sanctions screening (OpenSanctions /match — the POST body carries the company
  // name on its single allowed surface, ADR-28). The token env is a TEST value, never a secret.
  irRun(dir, "TR-021", "lei_code", "529900T8BM49AURSDO55", SIM);
  irRun(dir, "TR-025", "company_name", "Example Industries LLC", SIM, { IR_OPENSANCTIONS_TOKEN: "e2e-sim-token" });

  await openCase(page, caseId);

  // the registry record (the LEI node) and the screened company are in the projection
  const filter = page.getByTestId("entity-filter");
  await filter.fill("529900T8BM49AURSDO55");
  await expect(page.getByTestId("entity-table")).toContainText("529900T8BM49AURSDO55");

  // open the company node: the sanctions match carries its score (confidence) and — in its
  // source note — the reasons (the matched entity, the datasets it was matched against)
  await filter.fill("Example Industries");
  await page.getByTestId("entity-row").filter({ hasText: "Example Industries LLC" }).first().click();
  const detail = page.getByTestId("node-detail-panel");
  await expect(detail).toContainText("matches_sanctions_entry");
  // the score is displayed (0.87 from the /match response)
  await expect(detail.getByTestId("claim-confidence").filter({ hasText: "0.87" })).toHaveCount(1);
  // and the reasons are displayed verbatim in the source note — never a match without them
  await expect(detail).toContainText("score 0.87");
  await expect(detail).toContainText("datasets: us_ofac_sdn");

  // the registry record's own claim (the LEI's legal name) is visible on the LEI node
  await filter.fill("529900T8BM49AURSDO55");
  await page.getByTestId("entity-row").filter({ hasText: "529900T8BM49AURSDO55" }).first().click();
  await expect(detail).toContainText("has_legal_name");
  await expect(detail).toContainText("Example Industries LLC");
});
