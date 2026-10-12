import { describe, expect, it, afterEach } from "vitest";
import { customFetch, setBaseUrl } from "./custom-fetch.ts";

/** The same-origin guard (P2-003 / C) is what makes the custom-fetch.ts
 *  exemption in scripts/checks/no-direct-network.ts provable. */
describe("customFetch same-origin guard (P2-003 / C)", () => {
  afterEach(() => {
    setBaseUrl(null);
  });

  it("a relative path is allowed (same origin by construction)", async () => {
    // In Node there is no `location`, so a relative path resolves against
    // `http://localhost`. We only need to prove the guard does NOT throw for
    // a relative path — the fetch itself will fail (no server), which is
    // fine (we catch it).
    setBaseUrl(null);
    await expect(customFetch("/api/healthz")).rejects.not.toThrow(/cross-origin|absolute URL refused/);
  });

  it("a cross-origin absolute URL is refused", async () => {
    setBaseUrl("http://127.0.0.1:9999");
    await expect(customFetch("https://evil.example/x")).rejects.toThrow(/cross-origin request refused/);
  });

  it("an absolute URL with no configured origin is refused", async () => {
    setBaseUrl(null);
    await expect(customFetch("https://evil.example/x")).rejects.toThrow(/absolute URL refused/);
  });

  it("a same-origin absolute URL (matching the base) is allowed", async () => {
    setBaseUrl("http://127.0.0.1:9999");
    // Same origin as the base — the guard must NOT throw; the fetch itself
    // will fail (no server listening), which is fine.
    await expect(customFetch("http://127.0.0.1:9999/api/healthz")).rejects.not.toThrow(/cross-origin|absolute URL refused/);
  });
});
