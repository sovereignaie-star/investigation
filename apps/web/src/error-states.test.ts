// @vitest-environment jsdom
/**
 * P3-023 red-first: loading and failure states as BEHAVIOR.
 * Acceptance (ROADMAP P3-023): no white screen on any error, and an understandable,
 * COPYABLE error message in every failure state.
 *
 * Written before AppErrorBoundary / PageSkeleton / buildErrorReport existed: on the
 * pre-feature tree every test below fails (the modules are missing; a throwing page
 * unmounts the whole tree and leaves an empty #root — the white screen).
 */
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ar } from "../../../packages/i18n/src/ar";
import { en } from "../../../packages/i18n/src/en";
import { setLocale } from "@ir/i18n";

import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { PageSkeleton } from "./components/PageSkeleton";
import { buildErrorReport } from "./components/errorReport";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Pages are mocked per test: CasesPage throws on render to simulate a broken screen.
const pageState = { casesThrows: false };
vi.mock("./pages/CasesPage", () => ({
  CasesPage: () => {
    if (pageState.casesThrows) throw new Error("boom: cases page exploded");
    return React.createElement("p", { "data-testid": "cases-ok" }, "cases ok");
  },
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  setLocale("ar");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // React logs caught render errors to console.error; the tests assert on the UI instead.
  vi.spyOn(console, "error").mockImplementation(() => {});
  pageState.casesThrows = false;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  window.location.hash = "";
});

function Thrower({ message }: { message: string }): React.ReactElement {
  throw new Error(message);
}

function flush(): Promise<void> {
  return act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("AppErrorBoundary (P3-023)", () => {
  it("replaces a crashed subtree with a visible alert instead of an empty screen", () => {
    act(() => {
      root.render(React.createElement(AppErrorBoundary, { path: "/x" }, React.createElement(Thrower, { message: "boom-1" })));
    });
    expect(container.innerHTML).not.toBe("");
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain(ar["errors.boundary.title"]);
    expect(alert?.textContent).toContain("boom-1");
  });

  it("offers a copyable report: the copy button writes message, route and time to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    act(() => {
      root.render(React.createElement(AppErrorBoundary, { path: "/cases" }, React.createElement(Thrower, { message: "boom-copy" })));
    });
    const copy = container.querySelector<HTMLButtonElement>("[data-error-copy]");
    expect(copy).not.toBeNull();
    await act(async () => {
      copy?.click();
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    const report = String(writeText.mock.calls[0]?.[0]);
    expect(report).toContain("boom-copy");
    expect(report).toContain("/cases");
    expect(report).toMatch(/\d{4}-\d{2}-\d{2}T/);
    // visible feedback that the copy happened
    expect(container.textContent).toContain(ar["errors.boundary.copied"]);
  });

  it("the report text is also selectable on screen (clipboard may be unavailable)", () => {
    act(() => {
      root.render(React.createElement(AppErrorBoundary, { path: "/y" }, React.createElement(Thrower, { message: "boom-select" })));
    });
    const pre = container.querySelector("[data-error-report]");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain("boom-select");
  });

  it("retry re-renders the children once they stop throwing", () => {
    let shouldThrow = true;
    function Flaky(): React.ReactElement {
      if (shouldThrow) throw new Error("boom-flaky");
      return React.createElement("p", { "data-testid": "recovered" }, "ok");
    }
    act(() => {
      root.render(React.createElement(AppErrorBoundary, { path: "/z" }, React.createElement(Flaky)));
    });
    expect(container.querySelector("[data-testid=recovered]")).toBeNull();
    shouldThrow = false;
    const retry = container.querySelector<HTMLButtonElement>("[data-error-retry]");
    expect(retry).not.toBeNull();
    act(() => retry?.click());
    expect(container.querySelector("[data-testid=recovered]")).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("navigating to another route (path change) clears the error", () => {
    const Ok = (): React.ReactElement => React.createElement("p", { "data-testid": "ok-route" }, "ok");
    act(() => {
      root.render(React.createElement(AppErrorBoundary, { path: "/a" }, React.createElement(Thrower, { message: "b" })));
    });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    act(() => {
      root.render(React.createElement(AppErrorBoundary, { path: "/b" }, React.createElement(Ok)));
    });
    expect(container.querySelector("[data-testid=ok-route]")).not.toBeNull();
  });

  it("a failed lazy chunk (network error on import) lands in the boundary, not a blank page", async () => {
    const Broken = React.lazy(() => Promise.reject(new Error("Failed to fetch dynamically imported module")));
    act(() => {
      root.render(
        React.createElement(
          AppErrorBoundary,
          { path: "/lazy" },
          React.createElement(React.Suspense, { fallback: React.createElement(PageSkeleton) }, React.createElement(Broken)),
        ),
      );
    });
    await flush();
    await flush();
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("Failed to fetch dynamically imported module");
  });

  it("the error UI follows the locale (English)", () => {
    setLocale("en");
    act(() => {
      root.render(React.createElement(AppErrorBoundary, { path: "/e" }, React.createElement(Thrower, { message: "e-1" })));
    });
    expect(container.textContent).toContain(en["errors.boundary.title"]);
  });

  it("a non-Error throw (string/object) is still reported, never swallowed", () => {
    function ThrowsString(): React.ReactElement {
      throw "plain-string-failure";
    }
    act(() => {
      root.render(React.createElement(AppErrorBoundary, { path: "/s" }, React.createElement(ThrowsString)));
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("plain-string-failure");
  });
});

describe("buildErrorReport (P3-023)", () => {
  it("includes name, message, route, ISO time, and a bounded stack; no secrets-shaped tokens", () => {
    const err = new Error("kaput");
    const report = buildErrorReport(err, { path: "/cases", at: new Date("2026-10-21T01:00:00.000Z"), componentStack: "\n  at Foo" });
    expect(report).toContain("Error: kaput");
    expect(report).toContain("/cases");
    expect(report).toContain("2026-10-21T01:00:00.000Z");
    expect(report).toContain("at Foo");
    expect(report.length).toBeLessThan(8000);
  });

  it("truncates a huge stack so the report stays pasteable", () => {
    const err = new Error("big");
    err.stack = "Error: big\n" + "    at frame\n".repeat(5000);
    const report = buildErrorReport(err, { path: "/", at: new Date(0), componentStack: "" });
    expect(report.length).toBeLessThan(8000);
  });

  it("handles non-Error values", () => {
    expect(buildErrorReport({ code: 7 }, { path: "/", at: new Date(0), componentStack: "" })).toContain("code");
    expect(buildErrorReport("text", { path: "/", at: new Date(0), componentStack: "" })).toContain("text");
  });
});

describe("PageSkeleton (P3-023)", () => {
  it("is an accessible loading state (status role, aria-busy, localized text)", () => {
    act(() => {
      root.render(React.createElement(PageSkeleton));
    });
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.getAttribute("aria-busy")).toBe("true");
    expect(status?.textContent).toContain(ar["common.loading"]);
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });
});

describe("App integration (P3-023)", () => {
  it("a screen that throws shows the alert INSIDE the shell — nav and title survive (no white screen)", async () => {
    pageState.casesThrows = true;
    window.location.hash = "#/cases";
    const { default: App } = await import("./App");
    await act(async () => {
      root.render(React.createElement(App));
    });
    await flush();
    await flush();
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("boom: cases page exploded");
    // the shell is still there: the user can navigate away
    expect(container.textContent).toContain(ar["app.title"]);
    expect(container.querySelector("nav")).not.toBeNull();
  });

  it("the same screen renders normally when it does not throw", async () => {
    pageState.casesThrows = false;
    window.location.hash = "#/cases";
    const { default: App } = await import("./App");
    await act(async () => {
      root.render(React.createElement(App));
    });
    await flush();
    await flush();
    expect(container.querySelector("[data-testid=cases-ok]")).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("i18n keys (P3-023)", () => {
  it("every errors.* key exists in both dictionaries with non-empty text", () => {
    const keys = Object.keys(ar).filter((k) => k.startsWith("errors."));
    expect(keys.length).toBeGreaterThanOrEqual(6);
    for (const k of keys) {
      expect((ar as Record<string, string>)[k]).toBeTruthy();
      expect((en as Record<string, string>)[k]).toBeTruthy();
    }
  });
});
