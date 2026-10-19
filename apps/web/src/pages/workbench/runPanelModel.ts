/**
 * P3-011 (تقدم التشغيل الحي والإلغاء): the RunPanel state machine — the honest
 * run lifecycle in the UI. Pure view state (D-033): nothing here persists or
 * talks to the network; RunPanel.tsx feeds it events from the SSE stream and
 * the submit/cancel calls.
 *
 * Honesty rules encoded here:
 * - the terminal phase (succeeded/failed/cancelled) ends the run and keeps the
 *   full phase history;
 * - a cancel rejected by the server (e.g. 404 — the run already finished) is
 *   surfaced, never faked: on a terminal run the terminal state stands with a
 *   notice; on a live run the notice says the cancellation failed;
 * - a stream that closes WITHOUT a terminal event is a lost connection — never
 *   a success.
 */

export type RunPanelState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "live"; runId: string; phases: string[]; cancelling: boolean; notice: string | null }
  | { kind: "terminal"; runId: string; phases: string[]; phase: string; notice: string | null }
  | { kind: "connection-lost"; runId: string; phases: string[] }
  | { kind: "submit-error"; message: string };

export type RunPanelAction =
  | { type: "submit" }
  | { type: "submitted"; runId: string }
  | { type: "phase"; phase: string }
  | { type: "cancel-requested" }
  | { type: "cancel-rejected"; status: number; message: string }
  | { type: "submit-failed"; message: string }
  | { type: "stream-closed" };

const TERMINAL_PHASES = new Set(["succeeded", "failed", "cancelled"]);

export const initialRunPanelState: RunPanelState = { kind: "idle" };

/** Appends a phase to a live run; a terminal phase ends it. */
function applyPhase(state: Extract<RunPanelState, { kind: "live" }>, phase: string): RunPanelState {
  // Consecutive duplicates are collapsed (SSE snapshots can repeat a phase).
  const phases = state.phases[state.phases.length - 1] === phase ? state.phases : [...state.phases, phase];
  if (TERMINAL_PHASES.has(phase)) {
    return { kind: "terminal", runId: state.runId, phases, phase, notice: null };
  }
  return { ...state, phases, cancelling: false };
}

/** A cancel the server refused (e.g. 404 — already finished): honest display. */
function applyCancelRejected(state: RunPanelState, status: number, message: string): RunPanelState {
  if (state.kind === "live") {
    return { ...state, cancelling: false, notice: `تعذر الإلغاء (HTTP ${status}): ${message}` };
  }
  if (state.kind === "terminal") {
    return { ...state, notice: `الإلغاء مرفوض: التشغيل منتهٍ بالفعل (${state.phase})` };
  }
  return state;
}

export function runPanelReducer(state: RunPanelState, action: RunPanelAction): RunPanelState {
  switch (action.type) {
    case "submit":
      // A run can only be submitted from idle; anything else is ignored.
      return state.kind === "idle" ? { kind: "submitting" } : state;
    case "submitted":
      return state.kind === "submitting" ? { kind: "live", runId: action.runId, phases: [], cancelling: false, notice: null } : state;
    case "phase": {
      if (state.kind !== "live") return state;
      return applyPhase(state, action.phase);
    }
    case "cancel-requested":
      return state.kind === "live" ? { ...state, cancelling: true } : state;
    case "cancel-rejected":
      return applyCancelRejected(state, action.status, action.message);
    case "submit-failed":
      return state.kind === "submitting" ? { kind: "submit-error", message: action.message } : state;
    case "stream-closed":
      // Closed WITHOUT a terminal phase = the connection was lost mid-run.
      // Never inferred as success; the phases seen so far are kept.
      if (state.kind === "live") {
        return { kind: "connection-lost", runId: state.runId, phases: state.phases };
      }
      return state;
  }
}
