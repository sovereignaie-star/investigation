import { describe, expect, it, afterEach } from "vitest";
import { customFetch, setBaseUrl } from "./custom-fetch.js";

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

  it("a protocol-relative URL (`//evil.example/x`) is refused (resolves cross-origin)", async () => {
    setBaseUrl("http://127.0.0.1:9999");
    await expect(customFetch("//evil.example/x")).rejects.toThrow(/cross-origin request refused/);
  });

  it("a bare `//evil.example/x` with NO base is refused", async () => {
    setBaseUrl(null);
    await expect(customFetch("//evil.example/x")).rejects.toThrow(/absolute URL refused|cross-origin request refused/);
  });

  it("a `URL` object for a cross-origin host is refused", async () => {
    setBaseUrl("http://127.0.0.1:9999");
    await expect(customFetch(new URL("https://evil.example/x"))).rejects.toThrow(/cross-origin request refused/);
  });

  it("a `Request` for a cross-origin host is refused", async () => {
    setBaseUrl("http://127.0.0.1:9999");
    await expect(customFetch(new Request("https://evil.example/x"))).rejects.toThrow(/cross-origin request refused/);
  });

  it("a same-origin absolute URL (matching the base) is allowed", async () => {
    setBaseUrl("http://127.0.0.1:9999");
    // Same origin as the base — the guard must NOT throw; the fetch itself
    // will fail (no server listening), which is fine.
    await expect(customFetch("http://127.0.0.1:9999/api/healthz")).rejects.not.toThrow(/cross-origin|absolute URL refused/);
  });

  it("the guard rejects BEFORE fetch is called: a REFUSED input never reaches fetch (spied globalThis.fetch)", async () => {
    // Advisor C: prove the refusal happens in `customFetch` itself, not that
    // the (absent) network rejects it. Spy `globalThis.fetch`: the allowed
    // input must reach it; the refused input must NOT.
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    const restore: Array<() => void> = [];
    restore.push(() => {
      globalThis.fetch = realFetch;
    });
    try {
      globalThis.fetch = (async (input: string | URL | Request, _init?: RequestInit) => {
        calls.push(typeof input === "string" ? input : String(input));
        return new Response("ok");
      }) as typeof fetch;

      // ALLOWED: a relative path with a matching base — fetch IS called.
      setBaseUrl("http://127.0.0.1:9999");
      calls.length = 0;
      const r1 = await customFetch("/api/healthz");
      expect(r1).toBe("ok");
      expect(calls.length).toBe(1);
      expect(calls[0]).toContain("/api/healthz");

      // REFUSED: a cross-origin absolute URL — fetch is NOT called.
      calls.length = 0;
      await expect(customFetch("https://evil.example/x")).rejects.toThrow(/cross-origin request refused/);
      expect(calls.length).toBe(0);

      // REFUSED: protocol-relative with no base — fetch is NOT called.
      setBaseUrl(null);
      await expect(customFetch("//evil.example/x")).rejects.toThrow(/absolute URL refused|cross-origin request refused/);
      expect(calls.length).toBe(0);
    } finally {
      for (const r of restore.splice(0)) r();
    }
  });

  describe("parser-level bypasses (the guard uses the WHATWG URL parser, not a prefix regex)", () => {
    const realFetch = globalThis.fetch;
    const calls: string[] = [];
    function spy() {
      calls.length = 0;
      globalThis.fetch = (async (input: string | URL | Request) => {
        calls.push(input instanceof Request ? input.url : String(input));
        return new Response("ok");
      }) as typeof fetch;
    }
    afterEach(() => {
      globalThis.fetch = realFetch;
    });

    const hostile = [
      "//evil.example/x",
      "/\\evil.example/x",
      "\\\\evil.example/x",
      "/\t/evil.example/x",
      "/\n/evil.example/x",
      "\t//evil.example/x",
      " //evil.example/x",
      "https://evil.example/x",
      "https:evil.example/x",
      "HTTPS://EVIL.EXAMPLE/x",
      "http://127.0.0.1:9999@evil.example/x",
    ];
    for (const withBase of [false, true]) {
      for (const input of hostile) {
        it(`${JSON.stringify(input)} is refused before fetch (${withBase ? "with" : "without"} a base URL)`, async () => {
          spy();
          setBaseUrl(withBase ? "http://127.0.0.1:9999" : null);
          await expect(customFetch(input)).rejects.toThrow(/absolute URL refused|cross-origin request refused|cannot resolve/);
          expect(calls).toEqual([]);
        });
      }
    }

    it("negative control: a plain relative path still reaches fetch on the configured origin", async () => {
      spy();
      setBaseUrl("http://127.0.0.1:9999");
      await customFetch("/api/x?q=//evil.example");
      expect(calls).toEqual(["http://127.0.0.1:9999/api/x?q=//evil.example"]);
    });
  });
});
