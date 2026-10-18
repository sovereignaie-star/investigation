import * as irUi from "@ir/ui";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// P3-001: @ir/ui extracted from apps/sandbox (D-043) — the component library must
// be a workspace package consumed by apps/web, not a dev-tool internal.
describe("@ir/ui package (P3-001)", () => {
  it("exports the extracted shadcn component set", () => {
    const names = [
      "Accordion",
      "AlertDialog",
      "Avatar",
      "Badge",
      "Button",
      "Card",
      "CardHeader",
      "CardTitle",
      "CardDescription",
      "CardContent",
      "Checkbox",
      "Collapsible",
      "Dialog",
      "DropdownMenu",
      "Input",
      "Label",
      "Menubar",
      "Popover",
      "Progress",
      "RadioGroup",
      "ScrollArea",
      "Select",
      "Separator",
      "Sheet",
      "Skeleton",
      "Slider",
      "Switch",
      "Table",
      "Tabs",
      "Textarea",
      "Toast",
      "Tooltip",
    ];
    for (const name of names) {
      expect((irUi as Record<string, unknown>)[name], name).toBeDefined();
    }
  });

  it("renders Button to static markup with shadcn classes", () => {
    const html = renderToStaticMarkup(React.createElement(irUi.Button));
    expect(html).toContain("inline-flex");
    expect(html).toContain("items-center");
    expect(html).toContain("justify-center");
  });

  it("exports the cn utility and hooks", () => {
    expect(typeof irUi.cn).toBe("function");
    expect(typeof irUi.useIsMobile).toBe("function");
    expect(typeof irUi.useToast).toBe("function");
  });
});
