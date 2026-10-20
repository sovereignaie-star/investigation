/**
 * P3-020 / UC-06 — «أرشفة صفحة وحفظ لقطة موثقة (WARC + طابع زمني + تجزئة)» (ROADMAP 3.6):
 * the archiving journey on the simulation world. The engine side runs the REAL CLI: TR-012
 * fetches the page and hashes it; the documented post-step (the transform's own header)
 * serializes the WARC/1.0 container and stores it as case evidence beside the raw response.
 * The browser side opens the case and asserts the journey's output — the content hash and
 * the snapshot claims — and RE-OPENS the archived page through the evidence viewer, which
 * reads the case's own blob store: no network is involved (the acceptance: يستطيع فتح لقطة
 * موثقة دون شبكة).
 */
import path from "node:path";
import { expect, test } from "@playwright/test";
import { adminToken, caseDirOf, createCaseViaApi, fixturesDir, irRun, openCase, origin } from "./helpers.ts";

const SIM = path.join(fixturesDir, "uc06-sim.json");
const TARGET = "https://example.org/e2e-archive";
/** The P3-010 raw-evidence screen's submit button (ar). */
const VIEW_EVIDENCE = "عرض الدليل";

test("UC-06: a page is archived with its hash and snapshot, and re-opens without network", async ({ page }) => {
  const caseId = await createCaseViaApi("قضية أرشفة صفحة", "أرشفة صفحة في بيئة المحاكاة وحفظ لقطة موثقة بWARC وتجزئة وطابع زمني");
  const dir = caseDirOf(caseId);

  // the REAL engine path on the simulation world: the transform fetches the page itself
  const out = irRun(dir, "TR-012", "url", TARGET, SIM);
  expect(out).toContain("has_content_hash");
  expect(out).toContain("has_archive_snapshot");

  // the documented post-step stored the WARC container as evidence BESIDE the raw response:
  // two evidence entries for one archived page (raw + WARC), asserted through the real API
  const stats = await fetch(`${origin}/api/cases/${caseId}/stats`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });
  expect(stats.status).toBe(200);
  const body = (await stats.json()) as { counts: { evidence: number } };
  expect(body.counts.evidence).toBe(2);

  await openCase(page, caseId);

  // the archived URL node carries the hash and the snapshot claims
  const filter = page.getByTestId("entity-filter");
  await filter.fill(TARGET);
  await page.getByTestId("entity-row").filter({ hasText: TARGET }).first().click();
  const detail = page.getByTestId("node-detail-panel");
  await expect(detail).toContainText("has_content_hash");
  await expect(detail).toContainText("has_archive_snapshot");

  // the hash claim's evidence link names the raw response's evidence id — the snapshot
  // is re-opened through the P3-010 raw-evidence screen, which fetches the case's own
  // blob store (server-side hash verification, admin boundary) — NO network involved:
  // the acceptance criterion
  const evidenceId = (await detail.getByTestId("evidence-link").first().textContent()) ?? "";
  expect(evidenceId).not.toBe("");
  await page.goto("/#/evidence");
  await page.locator("#evidence-admin-token").fill(adminToken);
  await page.locator("#evidence-case-id").fill(caseId);
  await page.locator("#evidence-evidence-id").fill(evidenceId);
  await page.getByRole("button", { name: VIEW_EVIDENCE }).click();
  const viewer = page.getByTestId("evidence-viewer");
  // a real evidence record is open — its id and fetch time are displayed, not placeholders
  await expect(viewer.getByTestId("evidence-id")).not.toContainText("—");
  await expect(viewer.getByTestId("evidence-fetched-at")).not.toContainText("—");
  // the archived content itself renders inside the sandboxed iframe (the page body
  // from the case's blob — the viewer's DOMPurify + sandbox defense stays in place)
  const frame = page.frameLocator('[data-testid="evidence-frame"]');
  await expect(frame.locator("body")).toContainText("الصفحة المؤرشفة للاختبار");
});
