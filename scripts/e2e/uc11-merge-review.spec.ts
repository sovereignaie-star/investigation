/**
 * P4-005 / UC-11 — «دمج كيانين متشابهين بأسباب» (ROADMAP 5.14 / D9): the merge
 * review, driven through the REAL app — the panel opens on the analyst's
 * EXPLICIT request (the command palette), shows the pinned model's suggestions
 * with their reasons and the match score (درجة مطابقة — never a confidence),
 * and the human-accepted merge writes a real merge.decided event through the
 * real API. The acceptance's own «قابل للتراجع» is asserted END-TO-END: the
 * revert restores the case's semantic state and the state survives a full
 * reopen (both events stay in the valid ledger — the revert is an event, not
 * a deletion).
 *
 * The case is seeded with two similar person entities (different
 * canonicalKeys — the projection auto-unifies identical keys) appended
 * directly through the case store's write path, the same path the server
 * routes use.
 */
import { expect, test } from "@playwright/test";
import { openCase as openCaseStore } from "@ir/store";
import { adminToken, caseDirOf, createCaseViaApi, openCase } from "./helpers.ts";

const A = "01AAAAAAAAAAAAAAAAAAAAAAAA";
const B = "01BBBBBBBBBBBBBBBBBBBBBBBB";

/** Creates a case and seeds two similar person entities in its own ledger. */
async function seededCase(): Promise<string> {
  const caseId = await createCaseViaApi("قضية مراجعة الدمج", "التحقق من مراجعة الدمج والتراجع على إسقاط حقيقي في بيئة المحاكاة");
  const c = openCaseStore(caseDirOf(caseId), { actor: "e2e" });
  try {
    for (const [id, key] of [
      [A, "person:e2e-merge-a"],
      [B, "person:e2e-merge-b"],
    ] as const) {
      c.append("entity.added", {
        id,
        type: "person",
        canonicalKey: key,
        labels: { ar: "محمد السالم" },
        props: { country: "SA", birthDate: "1980-05-01" },
      });
    }
  } finally {
    c.close();
  }
  return caseId;
}

/** The entity table's rows for the two seeded persons (the merge's visible effect). */
const personRows = (page: import("@playwright/test").Page) => page.getByTestId("entity-row").filter({ hasText: "محمد السالم" });

test("UC-11: merge review — suggestions with reasons, human-accepted merge, revert restores the state", async ({ page }) => {
  const caseId = await seededCase();
  await openCase(page, caseId);

  // two similar entities are two rows before any merge
  await expect(personRows(page)).toHaveCount(2);

  // the panel opens on the analyst's EXPLICIT request: the command palette
  await page.keyboard.press("Control+k");
  await page.getByTestId("command-palette-input").fill("مراجعة الدمج");
  await page.getByTestId("command-case.mergeReview").click();
  const panel = page.getByTestId("merge-review");
  await expect(panel).toBeVisible();

  // the suggestion shows the pair, the match score (not a confidence) and its reasons
  const suggestion = page.getByTestId("merge-suggestion");
  await expect(suggestion).toBeVisible();
  await expect(suggestion).toContainText("درجة مطابقة");
  await expect(panel).toContainText("الأسباب");

  // the human's explicit decision: choose the survivor and accept
  await suggestion.getByTestId("merge-accept").first().click();
  // the write ends with a refreshed projection: the two rows become one
  await expect(personRows(page)).toHaveCount(1);
  await expect(panel.getByTestId("merge-log-entry")).toBeVisible();
  // the merge stays in the log (durable case data — the projection refresh keeps it)
  await expect(panel.getByTestId("merge-log-entry")).toContainText("محمد السالم");

  // «قابل للتراجع»: the revert restores the case's semantic state
  await panel.getByTestId("merge-revert").click();
  await expect(personRows(page)).toHaveCount(2);
  // the merge log now shows the honest reverted badge — the events stayed in the ledger
  await expect(panel.getByTestId("merge-reverted-badge")).toBeVisible();
  await panel.getByTestId("merge-review-close").click();
  await expect(panel).toBeHidden();

  // durability: after a full reopen the restored state is what the case itself holds
  // (the saved-token field is part of the query key — the case list refetches on reload)
  await page.reload();
  await page.getByTestId("saved-token").fill(adminToken);
  await openCase(page, caseId);
  await expect(personRows(page)).toHaveCount(2);
});

test("UC-11: the empty state is honest — a case with no similar pairs shows no suggestions", async ({ page }) => {
  const caseId = await createCaseViaApi("قضية بلا أزواج متشابهة", "التحقق من الحالة الفارغة الصادقة لمراجعة الدمج");
  const c = openCaseStore(caseDirOf(caseId), { actor: "e2e" });
  try {
    // two clearly different entities: no name block collision, no shared identifier
    for (const [id, name, key] of [
      ["01CCCCCCCCCCCCCCCCCCCCCCCC", "شركة تقنية", "company:e2e-x"],
      ["01DDDDDDDDDDDDDDDDDDDDDDDD", "مؤسسة تجارية", "company:e2e-y"],
    ] as const) {
      c.append("entity.added", { id, type: "company", canonicalKey: key, labels: { ar: name }, props: {} });
    }
  } finally {
    c.close();
  }
  await openCase(page, caseId);
  await page.keyboard.press("Control+k");
  await page.getByTestId("command-palette-input").fill("مراجعة الدمج");
  await page.getByTestId("command-case.mergeReview").click();
  await expect(page.getByTestId("merge-review-empty")).toBeVisible();
  await expect(page.getByTestId("merge-suggestion")).toBeHidden();
});
