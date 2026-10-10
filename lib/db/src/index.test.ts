// P0-014 — importing @workspace/db must not throw without DATABASE_URL (D-038).
import { afterEach, describe, expect, it, vi } from "vitest";

describe("@workspace/db", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("imports without DATABASE_URL and reports not configured", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const mod = await import("./index");
    expect(mod.isDatabaseConfigured()).toBe(false);
  });

  it("getDb() throws a clear error when DATABASE_URL is missing", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const mod = await import("./index");
    expect(() => mod.getDb()).toThrow(/DATABASE_URL must be set/);
  });
});
