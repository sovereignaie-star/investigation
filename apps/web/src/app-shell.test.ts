import * as React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import App from "./App";

// P3-002 acceptance: the web app renders inside the AppShell (layout/nav/theme/RTL).
describe("apps/web renders the AppShell (P3-002)", () => {
  it("wraps the workbench in an RTL AppShell", () => {
    const html = renderToStaticMarkup(React.createElement(App));
    expect(html).toMatch(/dir="rtl"/);
    expect(html).toContain("data-theme-toggle");
    expect(html).toContain("data-dir-toggle");
    expect(html).toContain("غرفة التحقيق");
  });
});
