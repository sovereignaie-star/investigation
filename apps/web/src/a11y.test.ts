// @vitest-environment jsdom
/**
 * P3-018 red-first: the accessibility gate — «axe بلا حرج» (G-23): every main
 * screen renders into a real DOM and axe-core reports ZERO violations of
 * impact critical/serious. The check runs on the honest rendered states
 * (loading/error) the screens are in without data — a keyboard or screen
 * reader user must be able to use them there too, not only in the happy path.
 */
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import Axe from "axe-core";
import { describe, expect, it, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import App from "./App";
import { CasesPage } from "./pages/CasesPage";
import { EvidencePage } from "./pages/EvidencePage";
import { SettingsPage } from "./pages/SettingsPage";
import { WorkbenchPage } from "./pages/WorkbenchPage";

/** Renders an element into a detached-but-real DOM and returns it. */
function mount(element: React.ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return { container, root };
}

const queryClient = (): QueryClient => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const inQueryClient = (element: React.ReactElement): React.ReactElement =>
  React.createElement(QueryClientProvider, { client: queryClient() }, element);

async function expectNoCriticalViolations(element: React.ReactElement, name: string): Promise<void> {
  const { container, root } = mount(inQueryClient(element));
  try {
    const results = await Axe.run(container);
    const serious = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    const summary = serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(",")).join(" | ")}`);
    expect(summary, `${name} — axe violations (critical/serious):\n${summary.join("\n")}`).toEqual([]);
  } finally {
    act(() => {
      root.unmount();
    });
    container.remove();
  }
}

describe("P3-018 — axe بلا حرج (accessibility of the main screens)", () => {
  it("the app shell + overview screen", async () => {
    await expectNoCriticalViolations(React.createElement(App), "overview");
  });

  it("the cases screen (token form + list)", async () => {
    await expectNoCriticalViolations(React.createElement(CasesPage), "cases");
  });

  it("the evidence screen (viewer form)", async () => {
    await expectNoCriticalViolations(React.createElement(EvidencePage), "evidence");
  });

  it("the settings screen (vault)", async () => {
    await expectNoCriticalViolations(React.createElement(SettingsPage), "settings");
  });

  it("the workbench screen (input flow)", async () => {
    await expectNoCriticalViolations(React.createElement(WorkbenchPage), "workbench");
  });
});

afterEach(() => {
  // jsdom keeps the document between tests inside one file — reset the body.
  document.body.innerHTML = "";
});
