import * as React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppShell, applyDir, applyTheme, nextTheme } from "@ir/ui";

// P3-002: the workbench app shell — layout, navigation, themes, RTL/LTR.
describe("AppShell (P3-002)", () => {
  const nav = [
    { id: "cases", label: "القضايا" },
    { id: "evidence", label: "سجل الأدلة", disabled: true },
  ];

  it("renders a shell with sidebar navigation and a main area", () => {
    const html = renderToStaticMarkup(
      React.createElement(AppShell, { title: "غرفة التحقيق", nav }, React.createElement("p", null, "المحتوى")),
    );
    expect(html).toContain("غرفة التحقيق");
    expect(html).toContain("القضايا");
    expect(html).toContain("سجل الأدلة");
    expect(html).toContain("المحتوى");
  });

  it("defaults to RTL and carries dir on the shell root", () => {
    const html = renderToStaticMarkup(React.createElement(AppShell, { title: "t", nav }, null));
    expect(html).toMatch(/dir="rtl"/);
  });

  it("renders LTR when dir is ltr", () => {
    const html = renderToStaticMarkup(React.createElement(AppShell, { title: "t", nav, dir: "ltr" }, null));
    expect(html).toMatch(/dir="ltr"/);
  });

  it("renders theme and direction toggles", () => {
    const html = renderToStaticMarkup(React.createElement(AppShell, { title: "t", nav }, null));
    expect(html).toContain("data-theme-toggle");
    expect(html).toContain("data-dir-toggle");
  });
});

describe("theme/direction helpers (P3-002)", () => {
  it("cycles theme light -> dark -> light", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("light");
  });

  it("applies theme and dir to a DOM-like element", () => {
    const el: { className: string; dir: string; lang: string; classList: { toggle: (name: string, force?: boolean) => boolean } } = {
      className: "",
      dir: "",
      lang: "",
      classList: {
        toggle(name, force) {
          const parts = el.className ? el.className.split(/\s+/) : [];
          const has = parts.includes(name);
          const want = force === undefined ? !has : force;
          el.className = want ? (has ? parts : [...parts, name]).join(" ") : parts.filter((c) => c !== name).join(" ");
          return want;
        },
      },
    };
    applyTheme(el, "dark");
    expect(el.className).toContain("dark");
    applyTheme(el, "light");
    expect(el.className).not.toContain("dark");
    applyDir(el, "ltr");
    expect(el.dir).toBe("ltr");
    expect(el.lang).toBe("en");
    applyDir(el, "rtl");
    expect(el.dir).toBe("rtl");
    expect(el.lang).toBe("ar");
  });
});
