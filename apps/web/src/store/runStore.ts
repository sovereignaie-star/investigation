import { create } from "zustand";

/**
 * P3-021: the live-run bridge between the run panel (which owns the run's state
 * machine) and the command surfaces (the palette's «إلغاء التشغيل الجاري»). The
 * panel registers its live run and its cancel intent when a run goes live; the
 * registry's run.cancel command reads exactly this — no duplicated run state, the
 * panel stays the single owner of the state machine.
 */
interface RunBridge {
  /** The live run's id, or null when no run is live. */
  liveRunId: string | null;
  /** The panel's cancel intent for the live run. */
  cancel: (() => void) | null;
  register: (runId: string | null, cancel: (() => void) | null) => void;
}

export const useRunBridge = create<RunBridge>((set) => ({
  liveRunId: null,
  cancel: null,
  register: (runId, cancel) => set({ liveRunId: runId, cancel }),
}));
