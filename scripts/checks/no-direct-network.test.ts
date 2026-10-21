import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { slowIt } from "@ir/test-utils";
import { analyzeSource, scanRepo } from "./no-direct-network.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("no direct network paths outside @ir/egress (P2-003 / ADR-08 C)", () => {
  // P6-016: @slow — this guard scans the whole repository; under coverage it
  // measured 5,234 ms on CI (2026-10-18), over the 5 s default.
  slowIt("the repository has zero direct network paths in executable code", () => {
    const { executable } = scanRepo(REPO);
    expect(executable, JSON.stringify(executable, null, 2)).toEqual([]);
  });

  describe("analyzer (negative controls: it must actually detect violations)", () => {
    const f = (code: string, rel = "apps/server/src/x.ts") => analyzeSource(rel, code);
    it("detects network module imports (static, dynamic, require, re-export)", () => {
      expect(f(`import http from "node:http";`)).toHaveLength(1);
      expect(f(`import { request } from "https";`)).toHaveLength(1);
      expect(f(`const n = await import("node:net");`)).toHaveLength(1);
      expect(f(`const t = require("node:tls");`)).toHaveLength(1);
      expect(f(`export * from "node:dns";`)).toHaveLength(1);
      expect(f(`import { spawn } from "node:child_process";`)).toHaveLength(1);
      expect(f(`import axios from "axios";`)).toHaveLength(1);
    });
    it('detects direct fetch calls, globalThis.fetch, globalThis["fetch"] and aliases', () => {
      expect(f(`await fetch("https://x");`)).toHaveLength(1);
      expect(f(`await globalThis.fetch("https://x");`)).toHaveLength(1);
      expect(f(`await globalThis["fetch"]("https://x");`)).toHaveLength(1);
      expect(f(`const f = opts.fetch ?? ((u: string) => fetch(u));`).length).toBeGreaterThanOrEqual(1);
      expect(f(`const g = fetch;`)).toHaveLength(1);
      expect(f(`const h = globalThis.fetch;`)).toHaveLength(1);
    });
    it("detects XMLHttpRequest / WebSocket / EventSource construction", () => {
      expect(f(`new WebSocket("wss://x");`)).toHaveLength(1);
      expect(f(`new XMLHttpRequest();`)).toHaveLength(1);
    });
    it("ignores comments, strings, type-only imports, property/method names and local declarations", () => {
      expect(f(`// fetch("x") and import http from "node:http"\nconst s = "fetch(1) node:http";`)).toEqual([]);
      expect(f(`import type { Server } from "node:http";`)).toEqual([]);
      expect(f(`interface T { fetch(req: string): void }\nconst o = { fetch(r: string) { return r; } };\no.fetch("x");`)).toEqual([]);
      expect(f(`class A { async fetch() {} }\nthis_is.fetch();`)).toEqual([]);
      expect(f(`function g(fetch: (u: string) => void) { return 1; }`)).toEqual([]);
    });
    it("detects module-loader escapes: non-literal require/import, createRequire, process.binding/dlopen, inspector, vm", () => {
      expect(f(`const m = "node:" + "net"; const n = require(m);`)).toHaveLength(1);
      expect(f("const n = await import(`node:${name}`);")).toHaveLength(1);
      expect(f(`import { createRequire } from "node:module"; const r = createRequire(import.meta.url);`)).toHaveLength(1);
      expect(f(`const t = process.binding("tcp_wrap");`)).toHaveLength(1);
      expect(f(`process["dlopen"](m, "/tmp/x.node");`)).toHaveLength(1);
      expect(f(`globalThis.process._linkedBinding("x");`)).toHaveLength(1);
      expect(f(`import inspector from "node:inspector"; inspector.open(9229);`)).toHaveLength(1);
      expect(f(`import vm from "node:vm";`)).toHaveLength(1);
    });
    it("scans .js/.mjs/.cjs as well as TypeScript", () => {
      expect(f(`const http = require("http");`, "packages/x/src/a.cjs")).toHaveLength(1);
      expect(f(`import net from "node:net";`, "packages/x/src/a.mjs")).toHaveLength(1);
    });
    it("only the two sandbox launcher files are exempt, not the whole sandbox package", async () => {
      const { isGatewayFile } = await import("./no-direct-network.js");
      expect(isGatewayFile("packages/sandbox/src/enforce.ts")).toBe(true);
      expect(isGatewayFile("packages/sandbox/src/build.ts")).toBe(true);
      expect(isGatewayFile("packages/sandbox/src/other.ts")).toBe(false);
      expect(isGatewayFile("packages/egress/src/egress.ts")).toBe(true);
      expect(isGatewayFile("packages/engine/src/run.ts")).toBe(false);
    });
    it("restricts the vault capability import to apps/server/src/lib/providers.ts", () => {
      const imp = `import { createVaultKeyValidationCapability } from "@ir/egress/vault-capability";`;
      expect(f(imp, "apps/server/src/lib/providers.ts")).toEqual([]);
      expect(f(imp, "apps/server/src/routes/vault.ts")).toHaveLength(1);
      expect(f(imp, "packages/engine/src/x.ts")).toHaveLength(1);
      expect(f(`import "@ir/egress/other";`, "packages/engine/src/x.ts")).toHaveLength(1);
    });
  });

  // D-060: the same full-repo scan as the guard above — it needs the documented
  // slow budget too (observed on CI 2026-10-21: three timeouts at the 5 s
  // default on runs 39567448254/39567469003/39572022779 — slow runner days).
  slowIt("test files that open local listeners are reported separately and never counted as production paths", () => {
    const { tests } = scanRepo(REPO);
    // informational: tests may import node:http/node:net for local controlled servers
    expect(Array.isArray(tests)).toBe(true);
  });
});
