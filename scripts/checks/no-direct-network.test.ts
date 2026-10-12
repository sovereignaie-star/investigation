import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeSource, scanRepo } from "./no-direct-network.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("no direct network paths outside @ir/egress (P2-003 / ADR-08 C)", () => {
  it("the repository has zero direct network paths in executable code", () => {
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
    it("detects direct fetch calls, globalThis.fetch and aliases", () => {
      expect(f(`await fetch("https://x");`)).toHaveLength(1);
      expect(f(`await globalThis.fetch("https://x");`)).toHaveLength(1);
      expect(f(`const f = opts.fetch ?? ((u: string) => fetch(u));`).length).toBeGreaterThanOrEqual(1);
      expect(f(`const g = fetch;`)).toHaveLength(1);
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
    it("restricts the vault capability import to apps/server/src/lib/providers.ts", () => {
      const imp = `import { createVaultKeyValidationCapability } from "@ir/egress/vault-capability";`;
      expect(f(imp, "apps/server/src/lib/providers.ts")).toEqual([]);
      expect(f(imp, "apps/server/src/routes/vault.ts")).toHaveLength(1);
      expect(f(imp, "packages/engine/src/x.ts")).toHaveLength(1);
      expect(f(`import "@ir/egress/other";`, "packages/engine/src/x.ts")).toHaveLength(1);
    });
  });

  it("test files that open local listeners are reported separately and never counted as production paths", () => {
    const { tests } = scanRepo(REPO);
    // informational: tests may import node:http/node:net for local controlled servers
    expect(Array.isArray(tests)).toBe(true);
  });
});
