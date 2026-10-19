import { describe, expect, it } from "vitest";

import { initialRunPanelState, runPanelReducer, type RunPanelState } from "./runPanelModel";

/**
 * P3-011: the RunPanel state machine — the honest run lifecycle in the UI.
 * The acceptance rules under test:
 * - phases stream in live and the terminal phase (succeeded/failed/cancelled) ends the run;
 * - a cancel that the server rejects with 404 (the run already finished) is shown
 *   honestly, never as a fake cancellation;
 * - a stream that closes WITHOUT a terminal event is a lost connection, never a success.
 */

function live(): RunPanelState {
  return runPanelReducer(runPanelReducer(initialRunPanelState, { type: "submit" }), {
    type: "submitted",
    runId: "run-0001-abc",
  });
}

describe("runPanelReducer (P3-011)", () => {
  it("starts idle, submitting on submit, live on submitted", () => {
    const s1 = runPanelReducer(initialRunPanelState, { type: "submit" });
    expect(s1).toEqual({ kind: "submitting" });
    const s2 = runPanelReducer(s1, { type: "submitted", runId: "run-0001-abc" });
    expect(s2).toEqual({ kind: "live", runId: "run-0001-abc", phases: [], cancelling: false, notice: null });
  });

  it("appends streamed phases live and dedupes consecutive repeats", () => {
    let s = live();
    s = runPanelReducer(s, { type: "phase", phase: "queued" });
    s = runPanelReducer(s, { type: "phase", phase: "queued" });
    s = runPanelReducer(s, { type: "phase", phase: "running" });
    expect(s).toMatchObject({ kind: "live", phases: ["queued", "running"] });
  });

  it("ends the run on a terminal phase, keeping the phase history", () => {
    let s = live();
    s = runPanelReducer(s, { type: "phase", phase: "running" });
    s = runPanelReducer(s, { type: "phase", phase: "succeeded" });
    expect(s).toEqual({ kind: "terminal", runId: "run-0001-abc", phases: ["running", "succeeded"], phase: "succeeded", notice: null });
  });

  it("marks cancelling on cancel-requested and clears it on the cancelled phase", () => {
    let s = live();
    s = runPanelReducer(s, { type: "phase", phase: "running" });
    s = runPanelReducer(s, { type: "cancel-requested" });
    expect(s).toMatchObject({ kind: "live", cancelling: true });
    s = runPanelReducer(s, { type: "phase", phase: "cancelled" });
    expect(s).toMatchObject({ kind: "terminal", phase: "cancelled" });
  });

  it("a 404 cancel rejection on a finished run is shown honestly — the terminal state stands", () => {
    let s = live();
    s = runPanelReducer(s, { type: "phase", phase: "succeeded" });
    s = runPanelReducer(s, { type: "cancel-rejected", status: 404, message: "run not found or already finished" });
    expect(s).toMatchObject({ kind: "terminal", phase: "succeeded" });
    expect((s as { notice?: string }).notice).toContain("منتهٍ");
  });

  it("a 404 cancel rejection on a LIVE run is an error, not a silent pass", () => {
    let s = live();
    s = runPanelReducer(s, { type: "phase", phase: "running" });
    s = runPanelReducer(s, { type: "cancel-rejected", status: 404, message: "run not found or already finished" });
    expect(s).toMatchObject({ kind: "live", cancelling: false });
    expect((s as { notice?: string }).notice).toContain("تعذر الإلغاء");
  });

  it("a stream closed without a terminal event is a lost connection — never a success", () => {
    let s = live();
    s = runPanelReducer(s, { type: "phase", phase: "running" });
    s = runPanelReducer(s, { type: "stream-closed" });
    expect(s).toEqual({ kind: "connection-lost", runId: "run-0001-abc", phases: ["running"] });
  });

  it("a failed submit is an honest error state", () => {
    const s = runPanelReducer(initialRunPanelState, { type: "submit" });
    const s2 = runPanelReducer(s, { type: "submit-failed", message: "401" });
    expect(s2).toEqual({ kind: "submit-error", message: "401" });
  });
});
