import { formatTimestamp, type DateDisplay } from "../utils/dates";

/**
 * P5-004: the date-display preference — a UI preference in the sense of the
 * browser storage policy (D-033): only view state, never case data, stored
 * under the registered key `ir.ui.date-format` (UI_PREFERENCE_KEYS). The
 * default is "raw" — the precision-verbatim ISO display of today's workbench;
 * Arabic-formatted dates (Gregorian / Hijri / both) are one click away.
 */

const STORAGE_KEY = "ir.ui.date-format";

const VALID: readonly DateDisplay[] = ["raw", "greg", "hijri", "both"];

type Listener = () => void;

const listeners = new Set<Listener>();
let current: DateDisplay = readStoredDateFormat();

function browserStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null; // storage access can throw (privacy modes, sandboxed iframes)
  }
}

/** The stored preference if valid, else the honest default — never an invented one. */
export function readStoredDateFormat(): DateDisplay {
  try {
    const raw = browserStorage()?.getItem(STORAGE_KEY) ?? null;
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "string" && (VALID as readonly string[]).includes(parsed)) {
        return parsed as DateDisplay;
      }
    }
  } catch {
    // unreadable storage holds nothing we can trust — the default stands
  }
  return "raw";
}

/** The current date-display preference (default: raw). */
export function getDateFormat(): DateDisplay {
  return current;
}

/** Switches the preference, persists it, and notifies every subscriber. */
export function setDateFormat(pref: DateDisplay): void {
  if (pref === current || !(VALID as readonly string[]).includes(pref)) return;
  current = pref;
  try {
    browserStorage()?.setItem(STORAGE_KEY, JSON.stringify(pref));
  } catch {
    // persistence is best-effort; the in-memory preference still applies
  }
  for (const listener of listeners) listener();
}

/** The external-store subscribe contract (useSyncExternalStore compatible). */
export function subscribeDateFormat(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Formats one timestamp with the current preference (convenience binding). */
export function formatWithPreference(iso: string): string {
  return formatTimestamp(iso, current);
}
