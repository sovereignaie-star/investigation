/**
 * Build the block-socket shim once and cache the .so path.
 * Returns the absolute path to the compiled .so, or undefined if the platform
 * does not support LD_PRELOAD (Windows, or a compiler is missing).
 *
 * The shim is written to a per-process directory (mkdtemp) with restrictive
 * permissions (0o700) so a hostile local user cannot pre-create or replace
 * the file (CodeQL: Insecure creation of file in the OS temp dir).
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const C_SOURCE = `/*
 * LD_PRELOAD shim (T-SBX / P2-005): blocks socket() for AF_INET / AF_INET6.
 * AF_UNIX (local IPC) is untouched.
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <sys/socket.h>
#include <errno.h>
#include <stdio.h>

int socket(int domain, int type, int protocol) {
    if (domain == AF_INET || domain == AF_INET6) {
        fprintf(stderr, "[block-socket] blocked AF_INET/AF_INET6 socket()\\n");
        errno = EACCES;
        return -1;
    }
    static int (*real_socket)(int, int, int) = 0;
    if (!real_socket) real_socket = dlsym(RTLD_NEXT, "socket");
    return real_socket(domain, type, protocol);
}
`;

export interface SandboxRuntime {
  /** Absolute path to the compiled .so, or undefined when unsupported. */
  readonly socketBlockerPath?: string;
  /** True if this platform supports LD_PRELOAD-based blocking. */
  readonly supported: boolean;
}

let cached: SandboxRuntime | undefined;

/**
 * A per-process directory under tmpdir (random suffix, 0o700). The `cc`
 * compiler is invoked to write the `.so` here, so the directory must be
 * non-world-readable and non-symlinked. Fail-closed on any anomaly.
 */
function makeShimDir(): string | undefined {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "ir-sandbox-shim-"));
  const st = statSync(dir);
  // A freshly-created mkdtemp dir is never a symlink (mkdtemp fails on a
  // symlinked parent; realpathSync above resolves it), and mkdtemp sets
  // 0o700. Confirm both before trusting it.
  if (!st.isDirectory() || st.mode & 0o077) {
    rmSync(dir, { recursive: true, force: true });
    return undefined;
  }
  return dir;
}

/** Write `source` to `file` and verify it is a regular file (no symlink swap). */
function writeVerified(file: string, source: string): boolean {
  writeFileSync(file, source, { mode: 0o600, flag: "wx" });
  const st = statSync(file);
  if (!st.isFile() || (st.mode & 0o077) !== 0) return false;
  // The `wx` flag refuses to overwrite an existing file, so a pre-created
  // (symlinked) path can never be written to.
  return true;
}

export function buildSocketBlocker(): SandboxRuntime {
  if (cached) return cached;
  if (process.platform !== "linux") {
    cached = { supported: false };
    return cached;
  }
  try {
    const dir = makeShimDir();
    if (!dir) {
      cached = { supported: false };
      return cached;
    }
    const src = join(dir, "block-socket.c");
    const out = join(dir, "block-socket.so");
    if (!writeVerified(src, C_SOURCE)) {
      cached = { supported: false };
      return cached;
    }
    const cc = ["cc", "gcc"].find((name) => {
      const r = spawnSync(name, ["--version"], { encoding: "utf8" });
      return r.status === 0;
    });
    if (!cc) {
      cached = { supported: false };
      return cached;
    }
    const build = spawnSync(cc, ["-shared", "-fPIC", "-o", out, src, "-ldl"], { encoding: "utf8" });
    if (build.status !== 0 || !existsSync(out)) {
      cached = { supported: false };
      return cached;
    }
    // Verify the produced artifact is a regular file, then lock its mode to
    // owner-only so no other local user can read or replace it.
    const st = statSync(out);
    if (!st.isFile()) {
      cached = { supported: false };
      return cached;
    }
    chmodSync(out, 0o600);
    const st2 = statSync(out);
    if ((st2.mode & 0o077) !== 0) {
      cached = { supported: false };
      return cached;
    }
    cached = { supported: true, socketBlockerPath: out };
    return cached;
  } catch {
    cached = { supported: false };
    return cached;
  }
}
