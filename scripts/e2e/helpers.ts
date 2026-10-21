/**
 * P3-020 — the E2E helpers: the engine side of the journeys runs through the REAL
 * CLI (`ir run` against the built `packages/cli/dist/ir.mjs`) on the deterministic
 * simulation world; the case creation runs through the REAL server API; the browser
 * side drives the real UI. The split is deliberate and documented: the web UI has
 * no "start investigation" surface yet, so the engine path is the CLI — the same
 * code the operator uses — and the UI asserts the journey's outcome on the case
 * the operator then opens (SavedInvestigations → projection).
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

/** The repo root (this file is scripts/e2e/helpers.ts). */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The built CLI — the real engine path (`ir run`). */
export const cliPath = path.join(repoRoot, "packages", "cli", "dist", "ir.mjs");

export const adminToken = process.env.E2E_ADMIN_TOKEN ?? "e2e-admin-token";
export const dataRoot = process.env.E2E_DATA_ROOT ?? "";
export const origin = process.env.E2E_BASE_URL ?? "http://127.0.0.1:18720";

/** The deterministic fixtures directory (sim rules per use case). */
export const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

/**
 * Creates a case through the REAL server API (the same API the CasesPage form uses)
 * with a documented purpose — UC-01's own requirement — and returns its id.
 */
export async function createCaseViaApi(title: string, purpose: string): Promise<string> {
  const res = await fetch(`${origin}/api/cases`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: JSON.stringify({ title, purpose, legalBasis: "due_diligence" }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string };
  expect(typeof body.id).toBe("string");
  return body.id;
}

/** The case directory of a case created through the server (J-18: SOVEREIGN_DATA_ROOT/cases/<id>). */
export function caseDirOf(caseId: string): string {
  return path.join(dataRoot, "cases", caseId);
}

/**
 * Runs `ir run <case-dir> <TR> <subject-type> <subject-value> --sim <rules>` — the REAL
 * engine path on the simulation world. Extra env (e.g. a test provider token) is passed
 * through. Returns the CLI's stdout for assertions.
 */
export function irRun(
  caseDir: string,
  transformId: string,
  subjectType: string,
  subjectValue: string,
  simRules: string,
  extraEnv: Record<string, string> = {},
): string {
  return execFileSync("node", [cliPath, "run", caseDir, transformId, subjectType, subjectValue, "--sim", simRules], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Enters the admin token in the shared in-memory getter (the CasesPage token field). The
 * field saves on change — P3-015's one-ref token — so filling it is the whole action.
 */
export async function enterAdminToken(page: Page): Promise<void> {
  await page.goto("/#/cases");
  await page.locator("#admin-token").fill(adminToken);
}

/**
 * Opens a saved case in the workbench (SavedInvestigations → the case's own projection).
 * The token field saves on change and refetches the list (the token is part of the query
 * key) — P3-015's cold-browser flow. The click is retried until the banner appears: a list
 * refetch re-render can replace the button between mousedown and mouseup, and the browser
 * then fires the click on the common ancestor — the handler never runs (a re-render race,
 * not an app bug; wider with a longer suite because the case list grows).
 */
export async function openCase(page: Page, caseId: string): Promise<void> {
  await page.goto("/#/workbench");
  await page.getByTestId("saved-token").fill(adminToken);
  await page.getByTestId(`saved-case-${caseId}`).waitFor();
  const banner = page.getByTestId("opened-case-banner");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await banner.isVisible()) return;
    // The open button is refreshed BEFORE the click and the row is scrolled into
    // view: with the list rendered above the open button, Playwright's click
    // auto-scroll can land the pointer on the saved-token field's row (the click
    // then hits the token input — a re-render race, not an app bug).
    const openButton = page.getByTestId(`open-case-${caseId}`);
    await openButton.scrollIntoViewIfNeeded();
    await openButton.click({ trial: true });
    await openButton.click();
    // a swallowed click shows nothing — wait a beat before judging, then retry
    await banner.waitFor({ timeout: 5_000 }).then(
      () => undefined,
      () => undefined,
    );
  }
  await banner.waitFor();
}
