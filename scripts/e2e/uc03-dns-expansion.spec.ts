/**
 * P3-020 / UC-03 — «توسيع نطاق إلى DNS وشهادات وIP وASN» (ROADMAP 3.6): the expansion
 * journey on the simulation world. The engine side runs through the REAL CLI (`ir run`
 * against @ir/sim): TR-001 (DNS), TR-004 (certificate transparency) and TR-006 (IP→ASN)
 * expand the domain into the case ledger. The browser side opens the case (its own
 * projection) and asserts the journey's output: the expanded entities, and every edge
 * carrying its source note («كل حافة لها ملاحظة مصدرية») with openable evidence.
 */
import path from "node:path";
import { expect, test } from "@playwright/test";
import { caseDirOf, createCaseViaApi, fixturesDir, irRun, openCase } from "./helpers.ts";

const SIM = path.join(fixturesDir, "uc03-sim.json");

test("UC-03: a domain expands to DNS records, a certificate name, and IP/ASN entities", async ({ page }) => {
  const caseId = await createCaseViaApi(
    "قضية توسيع النطاق",
    "توسيع نطاق في بيئة المحاكاة للتحقق من رحلة التوسيع كاملة عبر DNS والشهادات وIP وASN",
  );
  const dir = caseDirOf(caseId);

  // the REAL engine path on the simulation world (P2-008): three transforms, one case
  irRun(dir, "TR-001", "domain", "example.com", SIM);
  irRun(dir, "TR-004", "domain", "example.com", SIM);
  irRun(dir, "TR-006", "ipv4", "93.184.216.34", SIM);

  await openCase(page, caseId);

  // the expanded entities of the three runs are in the case's own projection:
  // the A record's IPv4, the certificate's subdomain, and the announcing ASN + prefix
  const filter = page.getByTestId("entity-filter");
  for (const value of ["93.184.216.34", "www.example.com", "AS15133", "93.184.216.0/24"]) {
    await filter.fill(value);
    await expect(page.getByTestId("entity-table")).toContainText(value);
  }

  // open the domain node: its relations carry the expansion — DNS answers, the certificate
  // name, and (through the IP) the ASN. Every relation renders its source note and links
  // its evidence (UC-03's acceptance: كل حافة لها ملاحظة مصدرية).
  await filter.fill("example.com");
  await page.getByTestId("entity-row").filter({ hasText: "example.com" }).first().click();
  const detail = page.getByTestId("node-detail-panel");
  await expect(detail).toContainText("resolves_to");
  await expect(detail).toContainText("has_subdomain");
  const notes = page.getByTestId("relation-source-note");
  const noteCount = await notes.count();
  expect(noteCount).toBeGreaterThan(0);
  for (let i = 0; i < noteCount; i++) {
    const text = await notes.nth(i).textContent();
    expect(text).toBeTruthy(); // no relation without its source note
  }
  // the source notes name their sources: the DNS record and the certificate
  await expect(page.getByTestId("relation-source-note").first()).toContainText("record for example.com");
  await expect(detail).toContainText("Certificate for www.example.com");
  // and every relation links openable evidence
  const evidenceLinks = page.getByTestId("evidence-link");
  expect(await evidenceLinks.count()).toBeGreaterThan(0);
});
