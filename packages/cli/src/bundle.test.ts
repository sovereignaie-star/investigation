import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const cliDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

// T-CLI-BUNDLE-001 — docker parity: the final image copies dist/ir.mjs alone (no
// node_modules) and its CI job runs `node ir.mjs --help`. The bundle must
// therefore start on its own. Regression for the jimp/gifwrap breakage
// (gifwrap's static `require('fs')` hit the ESM "Dynamic require" shim and
// crashed `ir --help` — the docker check failed on PR #167 before this test).
describe("bundled CLI (dist/ir.mjs)", () => {
  it("builds and starts without node_modules (docker parity)", () => {
    const build = spawnSync("pnpm", ["run", "build"], {
      cwd: cliDir,
      encoding: "utf8",
      env: { ...process.env },
    });
    expect(build.status, `build failed: ${build.stdout}\n${build.stderr}`).toBe(0);
    const ir = path.join(cliDir, "dist", "ir.mjs");
    expect(existsSync(ir)).toBe(true);
    const run = spawnSync(process.execPath, [ir, "--help"], {
      encoding: "utf8",
      env: { ...process.env },
    });
    expect(run.status, `ir.mjs --help failed: ${run.stdout}\n${run.stderr}`).toBe(0);
    expect(run.stderr).not.toContain("Dynamic require");
  });
});
