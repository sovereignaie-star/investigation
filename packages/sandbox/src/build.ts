/**
 * Builds the seccomp launcher (`seccomp-launcher.c`) for the transform sandbox (T-SBX / P2-005).
 *
 * The C source is read from this package and compiled into a fresh private temp dir (mode 0700, file mode 0500)
 * with the system C compiler. Nothing is downloaded and no prebuilt binary is committed. On any failure the
 * result is `supported: false` and the sandbox refuses to run transforms (fail-closed).
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface LauncherBuild {
  /** Absolute path of the compiled launcher, when supported. */
  readonly launcherPath?: string;
  readonly supported: boolean;
  /** Why the launcher is unavailable (diagnostics only). */
  readonly detail?: string;
}

let cached: LauncherBuild | undefined;

function fail(detail: string): LauncherBuild {
  cached = { supported: false, detail };
  return cached;
}

export function buildSeccompLauncher(): LauncherBuild {
  if (cached) return cached;
  if (process.platform !== "linux") return fail(`platform ${process.platform} has no seccomp`);
  if (process.arch !== "x64" && process.arch !== "arm64") return fail(`architecture ${process.arch} is not supported by the filter`);
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "seccomp-launcher.c"), "utf8");
    const dir = mkdtempSync(join(realpathSync(tmpdir()), "ir-sandbox-"));
    const st = statSync(dir);
    if (!st.isDirectory() || (st.mode & 0o077) !== 0) return fail("temp dir is not private");
    const src = join(dir, "launcher.c");
    const out = join(dir, "ir-seccomp-exec");
    writeFileSync(src, source, { mode: 0o600, flag: "wx" });
    const cc = ["cc", "gcc", "clang"].find((name) => spawnSync(name, ["--version"], { encoding: "utf8" }).status === 0);
    if (!cc) return fail("no C compiler available");
    const r = spawnSync(cc, ["-O2", "-Wall", "-Werror", "-o", out, src], { encoding: "utf8" });
    if (r.status !== 0 || !existsSync(out)) return fail(`launcher build failed: ${r.stderr}`);
    if (!statSync(out).isFile()) return fail("launcher is not a regular file");
    chmodSync(out, 0o500);
    cached = { supported: true, launcherPath: out };
    return cached;
  } catch (e) {
    return fail(`launcher build error: ${(e as Error).message}`);
  }
}
