/**
 * P3-022 / UC-08 — «التراجع والإعادة» (ROADMAP 3.2 P3-022): the view's edit history,
 * driven through the REAL app. The acceptance: undo reverses the view's edit
 * operations (a move, a hide, a remove-branch) and NEVER the case's own data — a
 * case deletion is an opposite ledger event (D1), never an erasure; notes are
 * case data and no view undo touches them.
 *
 * The byte-exact snapshot restoration (layouts + hidden, LIFO, bounded, linear-undo)
 * is proven by the unit suite (viewStateHistory.test.ts); here the REAL surfaces
 * are proven: the shortcuts fire, the toast names what happened, the rows come and
 * go, and a dragged node's move is a recorded, undoable edit.
 */
import path from "node:path";
import { expect, test } from "@playwright/test";
import { caseDirOf, createCaseViaApi, fixturesDir, irRun, openCase } from "./helpers.ts";

const SIM = path.join(fixturesDir, "uc05-sim.json");
const WALLET = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
const COUNTERPARTY = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";

/** The shared journey seed: a case whose projection holds the wallet, its counterparty and edges. */
async function seededCase(): Promise<string> {
  const caseId = await createCaseViaApi("قضية التراجع والإعادة", "إثبات أن عمليات تحرير العرض قابلة للتراجع دون أي مساس ببيانات القضية");
  const out = irRun(caseDirOf(caseId), "TR-016", "bitcoin_address", WALLET, SIM);
  expect(out).toContain("transacted_with");
  return caseId;
}

/** Selects the wallet's row (the keyboard entry points act on the SELECTION). */
async function selectWallet(page: import("@playwright/test").Page): Promise<void> {
  const filter = page.getByTestId("entity-filter");
  await filter.fill(WALLET);
  await page.getByTestId("entity-row").filter({ hasText: WALLET }).first().click();
}

test("UC-08: Ctrl+Z undoes a removal from the view; Ctrl+Shift+Z redoes it", async ({ page }) => {
  const caseId = await seededCase();
  await openCase(page, caseId);

  // Delete removes the selected node from the view (an EDIT, recorded in the history)
  await selectWallet(page);
  await page.keyboard.press("Delete");
  const table = page.getByTestId("entity-table");
  await expect(table).not.toContainText(WALLET);

  // Ctrl+Z brings it back — and the feedback names what happened
  await page.keyboard.press("Control+z");
  await expect(page.getByText("تم التراجع عن آخر عملية عرض")).toBeVisible();
  await expect(table).toContainText(WALLET);

  // Ctrl+Shift+Z redoes the removal (the other documented spelling, Ctrl+Y, is
  // asserted by the unit suite's matcher tests)
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByText("أعيدت آخر عملية عرض")).toBeVisible();
  await expect(table).not.toContainText(WALLET);
});

test("UC-08: Ctrl+Z undoes a whole-branch removal — the branch comes back intact", async ({ page }) => {
  const caseId = await seededCase();
  await openCase(page, caseId);

  // remove the branch: the wallet AND its counterparty leave the view
  await selectWallet(page);
  await page.keyboard.press("Shift+F10");
  await page.getByTestId("menu-node.removeBranch").click();
  await page.getByTestId("entity-filter").fill("");
  const table = page.getByTestId("entity-table");
  await expect(table).not.toContainText(WALLET);
  await expect(table).not.toContainText(COUNTERPARTY);

  // one undo restores the whole branch — the snapshot is the FULL view state
  await page.getByRole("heading", { name: "محطة العمل" }).click();
  await page.keyboard.press("Control+z");
  await expect(table).toContainText(WALLET);
  await expect(table).toContainText(COUNTERPARTY);
});

test("UC-08: undo NEVER touches the case's own data — the note survives every undo", async ({ page }) => {
  const caseId = await seededCase();
  await openCase(page, caseId);

  // a note is CASE data (a note.added entry in the case's hash-chained ledger)
  await selectWallet(page);
  await page.keyboard.press("Shift+F10");
  await page.getByTestId("menu-node.note").click();
  await page.getByTestId("note-text").fill("ملاحظة يجب أن تنجو من كل تراجع");
  await page.getByTestId("note-save").click();
  await expect(page.getByTestId("node-notes")).toContainText("ملاحظة يجب أن تنجو من كل تراجع");

  // view edits + undos around it — the note is not view state and no undo can touch it.
  // (Removing a node clears the SELECTION of the hidden node; undo restores the view
  // state, not the selection — the row is re-selected to observe the panel.)
  await page.keyboard.press("Delete");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await selectWallet(page);
  await expect(page.getByTestId("node-notes")).toContainText("ملاحظة يجب أن تنجو من كل تراجع");

  // and it is still durable across a full reopen
  await page.reload();
  await openCase(page, caseId);
  await selectWallet(page);
  await expect(page.getByTestId("node-notes")).toContainText("ملاحظة يجب أن تنجو من كل تراجع");
});

test("UC-08: dragging a node is a recorded edit — Ctrl+Z names it and undoes it", async ({ page }) => {
  const caseId = await seededCase();
  await openCase(page, caseId);

  // a drag is a MOVE only after the pointer travels: down on the canvas, move, up.
  // The undo command becomes AVAILABLE the moment a move is recorded — the palette
  // reflects the history's honesty (the unit suite proves the byte-exact restore).
  await selectWallet(page);
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("command-palette")).toBeVisible();
  await page.getByTestId("command-palette-input").fill("التراجع");
  // before any edit: no dead button — the undo command is absent (nothing to undo)
  await expect(page.getByTestId("command-view.undo")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("command-palette")).toBeHidden();
  // settle the focus back on the row (the palette's focus restore is async; the
  // menu closes on blur — a Shift+F10 racing it would open and instantly close)
  await page.getByTestId("entity-row").filter({ hasText: WALLET }).first().click();

  // «التركيز على العقدة» first: the camera centers on the wallet, so the canvas's
  // center is ON a node — the drag starts on the wallet itself, not on empty stage
  await page.keyboard.press("Shift+F10");
  await page.getByTestId("menu-node.focus").click();
  // the camera move needs a rendered frame before the canvas's hit-testing reflects
  // the new view (the pointer-to-node test uses the renderer's refreshed matrix)
  await page.waitForTimeout(300);

  // the drag: from the canvas's center, a real travel, release
  const canvas = page.getByTestId("investigation-graph");
  // the row clicks above may have scrolled the page (the entity table lives below
  // the canvas) — the canvas must be fully back in the viewport or the pointer
  // events land on nothing (the drag would silently record no edit)
  await page.evaluate("document.querySelector('[data-testid=investigation-graph]')?.scrollIntoView({ block: 'start' })");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("the graph canvas must have a bounding box");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy + 80, { steps: 8 });
  await page.mouse.up();

  // the move was RECORDED: the undo command is now available and Ctrl+Z runs it
  await page.keyboard.press("Control+k");
  await page.getByTestId("command-palette-input").fill("التراجع");
  await expect(page.getByTestId("command-view.undo")).toBeVisible();
  // the palette's exit animation keeps its search input mounted (and focused) for a
  // moment — a Ctrl+Z racing it is text-entry, not a command (docs/shortcuts.md);
  // wait for the unmount so focus is back on the workbench
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("command-palette")).toBeHidden();
  await page.keyboard.press("Control+z");
  await expect(page.getByText("تم التراجع عن آخر عملية عرض")).toBeVisible();
});
