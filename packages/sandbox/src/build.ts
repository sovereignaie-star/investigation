/**
 * Build the block-socket shim once and cache the .so path.
 * Returns the absolute path to the compiled .so, or undefined if the platform
 * does not support LD_PRELOAD (Windows, or a compiler is missing).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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

export function buildSocketBlocker(): SandboxRuntime {
  if (cached) return cached;
  const dir = join(tmpdir(), "ir-sandbox-shim");
  if (process.platform !== "linux") {
    cached = { supported: false };
    return cached;
  }
  try {
    mkdirSync(dir, { recursive: true });
    const src = join(dir, "block-socket.c");
    const out = join(dir, "block-socket.so");
    writeFileSync(src, C_SOURCE, "utf8");
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
    cached = { supported: true, socketBlockerPath: out };
    return cached;
  } catch {
    cached = { supported: false };
    return cached;
  }
}
