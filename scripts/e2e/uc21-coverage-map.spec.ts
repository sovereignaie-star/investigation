/**
 * P4-010 / UC-21 — «خريطة التغطية»: what was checked and what wasn't, driven
 * through the REAL app. The acceptance «كل محوّل فارغ يظهر» is asserted
 * END-TO-END: a transform whose only result is negative («بحثنا ولم نجد» — D3,
 * first-class coverage, never emptiness) STAYS VISIBLE on the map with its
 * honest state «فُحص بلا نتيجة». Failure is never mixed with emptiness (its
 * own cell says «فشل»), an untouched entity says so honestly, and the
 * entity×transform pairs with no observation are LISTED as unchecked — «ما لم
 * يُفحص» is visible, never hidden.
 *
 * The case is seeded through the case store's write path (the same path the
 * server routes use): four entities, one evidence record, three observations —
 * positive, negative-only (THE empty transform), error — and one entity with
 * no observation at all (untouched).
 *
 * Beyond the acceptance: hiding a node is VIEW state — the coverage map reads
 * the opened case's OWN full snapshot, so a hidden node's coverage never
 * disappears; «تحديث بيانات القضية» re-reads the projection and the map
 * reflects a check that ran while the case was open; and a pair the engine
 * recorded as never-run (P2-029 — «محظور بسياسة») appears from its own record,
 * never guessed from absence.
 */
import { expect, test } from "@playwright/test";
import { openCase as openCaseStore } from "@ir/store";
import { caseDirOf, createCaseViaApi, openCase } from "./helpers.ts";

const A = "01AAAAAAAAAAAAAAAAAAAAAAAA";
const B = "01BBBBBBBBBBBBBBBBBBBBBBBB";
const C = "01CCCCCCCCCCCCCCCCCCCCCCCC";
const D = "01DDDDDDDDDDDDDDDDDDDDDDDD";
const E = "01EGGGGGGGGGGGGGGGGGGGGGG1";
const EVIDENCE = "01EEEEEEEEEEEEEEEEEEEEEEEE";

/** Creates a case and seeds the coverage map's known truth. */
async function seededCase(): Promise<string> {
  const caseId = await createCaseViaApi("قضية خريطة التغطية", "إثبات خريطة التغطية: ما فُحص وما لم يُفحص، وكل محوّل فارغ يظهر");
  const c = openCaseStore(caseDirOf(caseId), { actor: "e2e" });
  try {
    for (const [id, key, label] of [
      [A, "domain:coverage-a.example", "موقع أ"],
      [B, "domain:coverage-b.example", "موقع ب"],
      [C, "domain:coverage-c.example", "موقع ج"],
      [D, "domain:coverage-d.example", "موقع د"],
      [E, "domain:coverage-e.example", "موقع هـ"],
    ] as const) {
      c.append("entity.added", { id, type: "domain", canonicalKey: key, labels: { ar: label }, props: {} });
    }
    const sha = "cd".repeat(32);
    c.append("evidence.stored", {
      id: EVIDENCE,
      sha256: sha,
      mime: "application/json",
      size: 2,
      blobRef: `blobs/cd/${sha}`,
      fetchedAt: "2026-03-01T00:00:00Z",
      request: { method: "LOCAL", url: "local://e2e", headers: {} },
      transformId: "tr-dns",
      version: "1",
    });
    // A — checked WITH results
    c.append("observation.added", {
      id: "01FFFFFFFFFFFFFFFFFFFFFFA1",
      entityId: A,
      transformId: "tr-dns",
      evidenceId: EVIDENCE,
      observedAt: "2026-03-01T10:00:00Z",
      kind: "positive",
    });
    // B — THE EMPTY TRANSFORM: «بحثنا ولم نجد» is coverage (D3), never filtered
    c.append("observation.added", {
      id: "01FFFFFFFFFFFFFFFFFFFFFFB1",
      entityId: B,
      transformId: "tr-empty",
      evidenceId: EVIDENCE,
      observedAt: "2026-03-02T10:00:00Z",
      kind: "negative",
    });
    // C — a failed check: error, never mixed with emptiness
    c.append("observation.added", {
      id: "01FFFFFFFFFFFFFFFFFFFFFFC1",
      entityId: C,
      transformId: "tr-dns",
      evidenceId: EVIDENCE,
      observedAt: "2026-03-03T10:00:00Z",
      kind: "error",
    });
    // D — untouched: no observation at all
    // E — policy-blocked (P2-029): the engine's own never-run record, taken
    // verbatim from the audit chain — «محظور بسياسة» is a recorded decision,
    // never guessed from the absence of an observation
    c.audit("investigate.not_run", "domain:coverage-e.example", {
      transform: "tr-dns",
      reason: "disabled: policy — source disabled on this case",
    });
  } finally {
    c.close();
  }
  return caseId;
}

test("UC-21: coverage map — what was checked and what wasn't; every empty transform shows; real selection", async ({ page }) => {
  const caseId = await seededCase();
  await openCase(page, caseId);

  const map = page.getByTestId("coverage-map");
  await expect(map).toBeVisible();

  const rows = page.getByTestId("coverage-row");
  await expect(rows).toHaveCount(5);

  // A — checked with results; the pair with no observation (tr-empty) is
  // listed unchecked — «ما لم يُفحص» is visible on the checked row too
  const rowA = rows.filter({ hasText: "موقع أ" });
  await expect(rowA).toContainText("فُحص بنتيجة");
  await expect(rowA).toContainText("لا فحص مسجل: tr-empty");

  // THE ACCEPTANCE — «كل محوّل فارغ يظهر»: the transform whose only result is
  // negative stays visible with its honest state, never filtered
  const rowB = rows.filter({ hasText: "موقع ب" });
  await expect(rowB).toContainText("tr-empty");
  await expect(rowB).toContainText("فُحص بلا نتيجة");

  // failure is never mixed with emptiness — the state badge itself says «فشل»
  // (asserted on its own element: the counts line contains «فشل» too)
  const rowC = rows.filter({ hasText: "موقع ج" });
  await expect(rowC.getByTestId("coverage-cell-state")).toHaveText("فشل");

  // the untouched entity says so honestly — nothing has been tried on it yet
  const rowD = rows.filter({ hasText: "موقع د" });
  await expect(rowD).toContainText("لا فحص مسجل بعد");
  await expect(rowD).toContainText("لا فحص مسجل: tr-dns، tr-empty");

  // E — policy-blocked: «محظور بسياسة» from its own audited record, with the
  // engine's verbatim reason — and NOT badged untouched (a decision was recorded)
  const rowE = rows.filter({ hasText: "موقع هـ" });
  await expect(rowE).toContainText("محظور بسياسة");
  await expect(rowE).toContainText("disabled: policy — source disabled on this case");
  await expect(rowE).not.toContainText("لا فحص مسجل بعد");

  // the row is the selection affordance — clicking it selects the node
  // and the detail panel opens (the real interaction)
  await rowA.click();
  await expect(page.getByTestId("node-detail-panel")).toBeVisible();
});

test("UC-21: hiding a node is view state — its coverage never disappears from the map", async ({ page }) => {
  const caseId = await seededCase();
  await openCase(page, caseId);

  const map = page.getByTestId("coverage-map");
  await expect(map).toContainText("موقع د");

  // remove D from the VIEW (the entity table's keyboard path: select + Delete)
  await page.getByTestId("entity-filter").fill("موقع د");
  await page.getByTestId("entity-row").filter({ hasText: "موقع د" }).first().click();
  await page.keyboard.press("Delete");
  // the view (the table) no longer shows it…
  await expect(page.getByTestId("entity-table")).not.toContainText("موقع د");
  // …but the coverage map reads the case's OWN full snapshot: D's row — and its
  // honest «لا فحص مسجل بعد» — is still there. Hiding a node never erases coverage.
  await expect(map).toContainText("موقع د");
  await expect(map).toContainText("لا فحص مسجل بعد");
});

test("UC-21: «تحديث بيانات القضية» re-reads the projection — the map reflects a check that ran while the case was open", async ({
  page,
}) => {
  const caseId = await seededCase();
  await openCase(page, caseId);

  // B's row shows only the empty transform (tr-empty) as checked — tr-dns ran
  // elsewhere in the case but never on B, so it is honestly LISTED unchecked
  const rowB = page.getByTestId("coverage-row").filter({ hasText: "موقع ب" });
  await expect(rowB).toContainText("فُحص بلا نتيجة");
  await expect(rowB).toContainText("لا فحص مسجل: tr-dns");

  // a check runs on B while the case is open (the store's write path — the
  // same path a real engine run takes through the server)
  const c = openCaseStore(caseDirOf(caseId), { actor: "e2e" });
  try {
    c.append("observation.added", {
      id: "01FFFFFFFFFFFFFFFFFFFFFFB2",
      entityId: B,
      transformId: "tr-dns",
      evidenceId: EVIDENCE,
      observedAt: "2026-03-04T10:00:00Z",
      kind: "positive",
    });
  } finally {
    c.close();
  }

  // the refresh command re-reads the case's own projection snapshot
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("command-palette")).toBeVisible();
  await page.getByTestId("command-palette-input").fill("تحديث بيانات القضية");
  await page.getByTestId("command-case.refresh").click();
  await expect(page.getByText("حُدّثت بيانات القضية")).toBeVisible();

  // the map now reflects the check that ran: B is checked with results on
  // tr-dns (the unchecked list drops it) — and the empty transform's negative
  // cell is still visible too
  await expect(rowB).toContainText("فُحص بنتيجة");
  await expect(rowB).not.toContainText("لا فحص مسجل: tr-dns");
  await expect(rowB).toContainText("tr-empty");
  await expect(rowB).toContainText("فُحص بلا نتيجة");
});
