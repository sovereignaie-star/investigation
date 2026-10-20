// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
// P3-017 red-first: @ir/i18n — the ar/en dictionary package. The acceptance is
// «صفر نص مضمن»: every UI string comes from this package's dictionaries.
import { dir, getLocale, setLocale, t, useI18n } from "./index";
import { ar } from "./ar";
import { en } from "./en";

describe("@ir/i18n — t() (P3-017)", () => {
  it("returns the Arabic message for a key under the default locale (ar)", () => {
    expect(t("common.loading")).toBe(ar["common.loading"]);
    expect(t("common.loading")).toMatch(/[\u0600-\u06FF]/);
  });

  it("interpolates {param} placeholders", () => {
    expect(t("resultNodes.evidenceBadge", { n: 3 })).toContain("3");
  });

  it("switches to English and back — t/dir follow the locale", () => {
    setLocale("en");
    expect(getLocale()).toBe("en");
    expect(t("common.loading")).toBe(en["common.loading"]);
    expect(dir()).toBe("ltr");
    setLocale("ar");
    expect(t("common.loading")).toBe(ar["common.loading"]);
    expect(dir()).toBe("rtl");
  });

  it("returns the key itself for an unknown key (visible, never silent)", () => {
    // Parity is enforced by the test below; this is the honest fallback — a
    // missing key shows up as the key, not as a blank or a crash.
    expect(t("test.missing.key" as never)).toBe("test.missing.key");
  });
});

describe("@ir/i18n — dictionary parity (P3-017)", () => {
  it("ar and en declare exactly the same keys (no missing translations)", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ar).sort());
  });

  it("no dictionary entry is empty", () => {
    for (const [k, v] of Object.entries(en)) {
      expect(typeof v === "string" && v.trim().length > 0, `empty en entry: ${k}`).toBe(true);
    }
  });
});

describe("@ir/i18n — useI18n() (P3-017)", () => {
  it("subscribes: a component re-renders with the new locale when it switches", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let render: number = 0;
    function Probe(): React.ReactElement {
      const i18n = useI18n();
      render += 1;
      return React.createElement("p", { "data-testid": "probe" }, `${i18n.locale}:${i18n.dir()}:${i18n.t("common.loading")}`);
    }
    const root = createRoot(container);
    act(() => {
      root.render(React.createElement(Probe));
    });
    expect(container.textContent).toContain("ar:rtl:");
    const rendersBefore = render;
    act(() => {
      setLocale("en");
    });
    expect(container.textContent).toContain("en:ltr:");
    expect(render).toBeGreaterThan(rendersBefore);
    act(() => {
      setLocale("ar");
    });
    expect(container.textContent).toContain("ar:rtl:");
    root.unmount();
    container.remove();
  });
});
