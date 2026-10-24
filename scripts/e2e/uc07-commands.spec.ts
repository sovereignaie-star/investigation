/**
 * P3-021 / UC-07 — «لوحة الأوامر والاختصارات وقائمة سياق العقدة» (ROADMAP 3.2 P3-021):
 * the command surfaces of the workbench, driven through the REAL app — the palette
 * (Ctrl/Cmd+K), the node context menu (right-click and Shift+F10), and the actions the
 * ROADMAP's acceptance names: تفاصيل، إعادة جلب، نسخ، ملاحظة، حذف عقدة/فرع، تركيز.
 *
 * The case is seeded through the REAL engine path (the CLI on the simulation world —
 * the same UC-05 world: a wallet, its counterparty and the transaction hashes) so the
 * menu's actions operate on a real projection with real nodes and edges. The note is
 * asserted as DURABLE case data: it saves through the real API (POST /cases/:id/notes)
 * and reappears after a full reopen — the acceptance's own «إعادة فتح» requirement.
 */
import path from "node:path";
import { expect, test } from "@playwright/test";
import { caseDirOf, createCaseViaApi, fixturesDir, irRun, openCase } from "./helpers.ts";

const SIM = path.join(fixturesDir, "uc05-sim.json");
const WALLET = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
const COUNTERPARTY = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";
const NOTE_TEXT = "المعرّف يحتاج مصدراً ثانوياً قبل الاعتماد عليه";

/** The shared journey seed: a case whose projection holds the wallet, its counterparty and edges. */
async function seededCase(): Promise<string> {
  const caseId = await createCaseViaApi(
    "قضية أسطح الأوامر",
    "التحقق من لوحة الأوامر وقائمة السياق والاختصارات على إسقاط حقيقي في بيئة المحاكاة",
  );
  const out = irRun(caseDirOf(caseId), "TR-016", "bitcoin_address", WALLET, SIM);
  expect(out).toContain("transacted_with");
  return caseId;
}

/** Selects the wallet's row (the menu's keyboard entry point acts on the SELECTION). */
async function selectWallet(page: import("@playwright/test").Page): Promise<void> {
  const filter = page.getByTestId("entity-filter");
  await filter.fill(WALLET);
  await page.getByTestId("entity-row").filter({ hasText: WALLET }).first().click();
}

test("UC-07: the palette opens with Ctrl+K, filters by search, and executes a command", async ({ page }) => {
  const caseId = await seededCase();
  await openCase(page, caseId);
  // node commands act on the SELECTION — a selected node makes them available
  await selectWallet(page);

  // Ctrl+K opens the palette; focus is in its search input
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("command-palette")).toBeVisible();
  await expect(page.getByTestId("command-palette-input")).toBeFocused();

  // search narrows the list to the note command
  await page.getByTestId("command-palette-input").fill("ملاحظة");
  await expect(page.getByTestId("command-node.note")).toBeVisible();
  await expect(page.getByTestId("command-nav.cases")).toBeHidden();

  // Escape closes the palette and returns focus to the workbench
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("command-palette")).toBeHidden();

  // executing a command runs its real action: «فتح شاشة القضايا» navigates
  await page.keyboard.press("Control+k");
  await page.getByTestId("command-palette-input").fill("شاشة القضايا");
  await page.getByTestId("command-nav.cases").click();
  await expect(page).toHaveURL(/#\/cases/);
});

test("UC-07: Shift+F10 opens the node context menu on the selected node and copies the key with feedback", async ({ page }) => {
  const caseId = await seededCase();
  await openCase(page, caseId);
  await selectWallet(page);

  // Shift+F10 (the keyboard entry point) positions the menu at the selected row
  await page.keyboard.press("Shift+F10");
  const menu = page.getByTestId("node-context-menu");
  await expect(menu).toBeVisible();

  // the acceptance's six actions are all present
  for (const id of ["node.details", "node.refetch", "node.copyKey", "node.note", "node.removeBranch", "node.focus"]) {
    await expect(page.getByTestId(`menu-${id}`)).toBeVisible();
  }

  // «نسخ» copies the key and the feedback is honest (a toast names what happened)
  await page.getByTestId("menu-node.copyKey").click();
  await expect(menu).toBeHidden();
  await expect(page.getByText("تم النسخ")).toBeVisible();
});

test("UC-07: a note saves through the real API and survives a full reopen", async ({ page }) => {
  const caseId = await seededCase();
  await openCase(page, caseId);
  await selectWallet(page);

  // the note dialog opens from the context menu (right-click — the pointer entry point)
  await page.getByTestId("entity-row").filter({ hasText: WALLET }).first().click({ button: "right" });
  await expect(page.getByTestId("node-context-menu")).toBeVisible();
  await page.getByTestId("menu-node.note").click();

  const dialog = page.getByTestId("note-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("note-text")).toBeFocused();
  await page.getByTestId("note-text").fill(NOTE_TEXT);
  await page.getByTestId("note-save").click();

  // the save's feedback names the durability contract (the case's own ledger)
  await expect(page.getByText("حُفظت الملاحظة في سجل القضية")).toBeVisible();
  // and the note is immediately visible on the node's detail panel
  await expect(page.getByTestId("node-notes")).toContainText(NOTE_TEXT);

  // a full reopen (new page load, the case opened again) is the durability assertion
  await page.reload();
  await openCase(page, caseId);
  await selectWallet(page);
  await expect(page.getByTestId("node-notes")).toContainText(NOTE_TEXT);
});

test("UC-07: removing a node (and its branch) from the view is reversible — «إظهار كل العقد» restores", async ({ page }) => {
  const caseId = await seededCase();
  await openCase(page, caseId);

  // Delete (the documented shortcut) removes the SELECTED node from the view only
  await selectWallet(page);
  await page.keyboard.press("Delete");
  await expect(page.getByText("أُزيلت 1 عقدة من العرض")).toBeVisible();
  const table = page.getByTestId("entity-table");
  await expect(table).not.toContainText(WALLET);

  // the palette's «إظهار كل العقد» restores it — the removal never touched the case data
  await page.keyboard.press("Control+k");
  await page.getByTestId("command-palette-input").fill("إظهار كل");
  await page.getByTestId("command-view.showAll").click();
  await expect(table).toContainText(WALLET);
  await expect(page.getByText("أُعيدت كل العقد إلى العرض")).toBeVisible();

  // «إزالة العقدة والفرع من العرض» removes the branch closure: the wallet AND its
  // counterparty (reachable over the outgoing transacted_with edge)
  await selectWallet(page);
  await page.keyboard.press("Shift+F10");
  await page.getByTestId("menu-node.removeBranch").click();
  // the filter is cleared so the assertions see the VIEW (the branch removal),
  // not the filter's intersection with it
  await page.getByTestId("entity-filter").fill("");
  await expect(table).not.toContainText(WALLET);
  await expect(table).not.toContainText(COUNTERPARTY);
  // …the branch closure is the wallet plus every node reachable from it (the
  // counterparty AND the transaction hashes of the run) — the toast names the count
  // P6-024: the exact count, not a regex — the first removal's toast («أُزيلت 1 عقدة»)
  // can still be on screen at this point (its auto-hide hadn't elapsed on a loaded
  // runner — run 40084357303) and the regex matched BOTH toasts → strict-mode violation.
  // The branch closure is deterministic: the wallet + the counterparty + this run's two
  // transaction hashes — the toast names exactly that count.
  await expect(page.getByText("أُزيلت 4 عقدة من العرض")).toBeVisible();

  // …and the branch removal is equally reversible (the filter is cleared first so the
  // table's content is the VIEW, not the filter's intersection; focus leaves the
  // filter's input — text surfaces swallow shortcuts by design, docs/shortcuts.md)
  await page.getByTestId("entity-filter").fill("");
  // the view is empty at this point (the whole branch was removed) — any non-text
  // surface moves focus out of the filter's input
  await page.getByRole("heading", { name: "محطة العمل" }).click();
  await page.keyboard.press("Control+k");
  await page.getByTestId("command-palette-input").fill("إظهار كل");
  await page.getByTestId("command-view.showAll").click();
  await expect(table).toContainText(WALLET);
  await expect(table).toContainText(COUNTERPARTY);
});

test("UC-07: «التركيز على العقدة» moves the camera onto the node", async ({ page }) => {
  const caseId = await seededCase();
  await openCase(page, caseId);

  // the camera mirror exposes the graph coordinates the acceptance can assert on
  const camera = page.getByTestId("graph-camera");
  await expect(camera).toHaveAttribute("data-ratio", "1");

  // select the counterparty (a node away from the default camera position) and focus it
  const filter = page.getByTestId("entity-filter");
  await filter.fill(COUNTERPARTY);
  await page.getByTestId("entity-row").filter({ hasText: COUNTERPARTY }).first().click();
  const before = await camera.getAttribute("data-x");
  await page.keyboard.press("Shift+F10");
  await page.getByTestId("menu-node.focus").click();

  // the camera moved onto the node's own coordinates (not the default center)
  const after = await camera.getAttribute("data-x");
  expect(after).not.toBeNull();
  expect(after).not.toBe(before);
});
