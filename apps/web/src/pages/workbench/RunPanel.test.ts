import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RunPanelView, type RunPanelViewProps } from "./RunPanel";
import type { RunPanelState } from "./runPanelModel";

/**
 * P3-011: the RunPanel's presentational states, checked headlessly via static
 * markup (the app's established web test pattern, P3-002/P3-007/P3-008 — JSX is
 * spelled React.createElement so the file stays a .ts test like its siblings).
 * The wiring (fetch SSE + cancel) lives in RunPanel; the view renders the state
 * machine's honest states: live phases, cancellation, terminal, lost connection.
 */

const noop = () => undefined;

function render(state: RunPanelState, extra: Partial<RunPanelViewProps> = {}): string {
  const props: RunPanelViewProps = {
    state,
    form: { kind: "lookup", canonicalInput: "https://example.com/a" },
    token: "admin-token-123",
    onFormChange: noop,
    onTokenChange: noop,
    onSubmit: noop,
    onCancel: noop,
    ...extra,
  };
  return renderToStaticMarkup(React.createElement(RunPanelView, props));
}

describe("RunPanelView (P3-011)", () => {
  it("renders the submit form (kind + canonicalInput + token) in the idle state", () => {
    const html = render({ kind: "idle" });
    expect(html).toContain('data-testid="run-submit"');
    expect(html).toContain('data-testid="run-kind-input"');
    expect(html).toContain('data-testid="run-input-input"');
    expect(html).toContain('data-testid="run-token-input"');
    expect(html).not.toContain('data-testid="run-cancel"');
  });

  it("renders the live phases and the cancel button while the run is live", () => {
    const html = render({ kind: "live", runId: "run-0001-abc", phases: ["queued", "running"], cancelling: false, notice: null });
    expect(html).toContain('data-testid="run-phases"');
    expect(html).toContain("في الانتظار");
    expect(html).toContain("قيد التشغيل");
    expect(html).toContain('data-testid="run-cancel"');
    expect(html).toContain("run-0001-abc");
  });

  it("disables the cancel button while a cancellation is in flight", () => {
    const html = render({ kind: "live", runId: "run-0001-abc", phases: ["running"], cancelling: true, notice: null });
    expect(html).toContain('data-testid="run-cancel"');
    expect(html).toContain("disabled");
  });

  it("renders the terminal phase with the full phase history and no cancel button", () => {
    const html = render({ kind: "terminal", runId: "run-0001-abc", phases: ["queued", "running", "succeeded"], phase: "succeeded" });
    expect(html).toContain('data-testid="run-terminal"');
    expect(html).toContain("اكتمل بنجاح");
    expect(html).not.toContain('data-testid="run-cancel"');
  });

  it("renders a lost connection honestly — never as success", () => {
    const html = render({ kind: "connection-lost", runId: "run-0001-abc", phases: ["running"] });
    expect(html).toContain('data-testid="run-connection-lost"');
    expect(html).not.toContain('data-testid="run-terminal"');
  });
});
