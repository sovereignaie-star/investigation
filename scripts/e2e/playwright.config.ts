/**
 * P3-020 — the Playwright E2E configuration: the six use cases of ROADMAP 3.6
 * (UC-01..UC-06) driven through the REAL app — the built web UI served by the
 * built API server, with the engine side of the journeys (UC-03..UC-06) driven
 * through the REAL CLI (`ir run`) on the deterministic simulation world
 * (@ir/sim, P2-008/D11). One fresh data root per run is created here and shared
 * with the spawned server (SOVEREIGN_DATA_ROOT) and the CLI runs (case dirs);
 * nothing persists between runs.
 */
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

/**
 * A fresh cases/vault root per run — passed to the server AND the CLI spawns. Playwright
 * re-evaluates this module in every worker process, so the root is created ONCE (by the
 * first evaluation) and every later evaluation — and every spec file's helpers — reuses the
 * same path through the inherited E2E_DATA_ROOT: the server and the CLI always agree.
 */
const existingRoot = process.env.E2E_DATA_ROOT;
export const dataRoot =
  existingRoot !== undefined && existingRoot !== "" && existsSync(existingRoot)
    ? existingRoot
    : mkdtempSync(path.join(tmpdir(), "e2e-data-"));
process.env.E2E_DATA_ROOT = dataRoot;

/** The admin token of the run — a test value, never a real secret (L-13 pattern). */
export const adminToken = process.env.E2E_ADMIN_TOKEN ?? "e2e-admin-token";
process.env.E2E_ADMIN_TOKEN = adminToken;

const port = 18720;

export default defineConfig({
  testDir: ".",
  // P4-012: the geo map view has no numbered UC (it is a workbench screen,
  // roadmap 938) — its e2e spec is named map-view.spec.ts and joins the match
  // explicitly. Every other spec stays bound to its UC number (ucNN-…).
  testMatch: /uc\d{2}.*\.spec\.ts|map-view\.spec\.ts/,
  timeout: 60_000,
  // one server, one data root — sequential keeps the world deterministic
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    // cwd is the config directory by default — the relative path reaches the built server
    command: "node ../../apps/server/dist/index.mjs",
    url: `http://127.0.0.1:${port}/api/healthz`,
    timeout: 30_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      IR_ADMIN_TOKEN: adminToken,
      SOVEREIGN_DATA_ROOT: dataRoot,
      IR_DATA_DIR: path.join(dataRoot, "vault"),
      // L-53: the CI failure artifact proved case-open received HTTP 429 — the issuer is
      // one of the two /api limiters (global 300/min or cases-route 60/min); which one
      // fired in CI is not conclusively distinguishable from the artifact, so BOTH
      // ceilings are raised for this suite — a mitigation robust to either cause, not
      // a proof of which one fired. It is ONE trusted hermetic client
      // (127.0.0.1, no abuse surface) whose accumulated load plausibly crossed the
      // ceilings in CI's slower 60s windows (hypothesis, not proven). The limiter code
      // still runs (nothing is disabled); IR_API_RATE_LIMIT is the pre-existing global
      // knob (app.ts), and IR_CASES_RATE_LIMIT is the per-route override shipped with
      // a documented red-first test (cases-routes.test.ts). Production defaults are
      // unchanged (300/min, 60/min).
      IR_API_RATE_LIMIT: "6000",
      IR_CASES_RATE_LIMIT: "6000",
    },
  },
});
