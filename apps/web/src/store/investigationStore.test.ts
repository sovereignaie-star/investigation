import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { InvestigationNode } from "../types";

/** In-memory Storage that records every write, installed before the store module loads. */
class MemoryStorage implements Storage {
  #m = new Map<string, string>();
  writes: string[] = [];
  get length() {
    return this.#m.size;
  }
  clear() {
    this.#m.clear();
  }
  getItem(k: string) {
    return this.#m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.#m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.#m.delete(k);
  }
  setItem(k: string, v: string) {
    this.writes.push(k);
    this.#m.set(k, String(v));
  }
}

const local = new MemoryStorage();
const session = new MemoryStorage();
let store: typeof import("./investigationStore").useInvestigationStore;
let purge: typeof import("./storagePolicy").purgeLegacyCaseStorage;

beforeAll(async () => {
  Object.assign(globalThis, { localStorage: local, sessionStorage: session });
  store = (await import("./investigationStore")).useInvestigationStore;
  purge = (await import("./storagePolicy")).purgeLegacyCaseStorage;
});
afterEach(() => {
  local.clear();
  local.writes.length = 0;
});

const node = (id: string, depth = 0): InvestigationNode => ({
  id,
  type: "text",
  identifier: id,
  identifierType: "email",
  value: id,
  label: id,
  data: { secret: "case content" },
  metadata: {},
  status: "done",
  position: { x: 0, y: 0 },
  depth,
  timestamp: 0,
});

describe("P1-021: no case data in browser storage", () => {
  it("the view store works in memory and never writes localStorage or sessionStorage", () => {
    const s = store.getState();
    s.addNode(node("email:a@example.com"));
    s.addNode(node("domain:example.com", 1));
    s.addEdge({ id: "e1", source: "email:a@example.com", target: "domain:example.com" });
    s.updateNode("domain:example.com", { status: "error" });
    s.setSelectedNode("domain:example.com");
    s.loadInvestigation(store.getState().nodes, store.getState().edges, store.getState().stats);
    expect(store.getState().nodes).toHaveLength(2);
    expect(store.getState().stats).toMatchObject({ nodeCount: 2, edgeCount: 1, maxDepth: 1 });
    expect(local.writes).toEqual([]);
    expect(session.writes).toEqual([]);
    expect(local.length + session.length).toBe(0);
    s.clearInvestigation();
  });

  it("start-up purge removes the graph left by older builds, and is harmless when storage is missing or throws", () => {
    local.setItem("investigation-store", JSON.stringify({ state: { nodes: [node("x")] }, version: 0 }));
    local.setItem("ui-theme", "dark");
    expect(purge(local)).toEqual(["investigation-store"]);
    expect(local.getItem("investigation-store")).toBeNull();
    expect(local.getItem("ui-theme")).toBe("dark");
    expect(purge(local)).toEqual([]);
    expect(purge(null)).toEqual([]);
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      removeItem: () => undefined,
    };
    expect(purge(throwing)).toEqual([]);
  });

  it("guard: no source file in apps/web persists state or writes browser storage", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const p = path.join(d, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) files.push(p);
      }
    };
    walk(root);
    const offenders = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      return (
        /from\s+["']zustand\/middleware["']/.test(src) ||
        /(localStorage|sessionStorage)\s*\.\s*setItem|(localStorage|sessionStorage)\s*\[/.test(src)
      );
    });
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
    expect(files.length).toBeGreaterThan(10);
  });
});
