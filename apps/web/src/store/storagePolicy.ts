/**
 * Browser storage policy (P1-021, D-033): no case data in localStorage or sessionStorage. Older builds persisted the
 * whole graph under "investigation-store" (Zustand persist); it is deleted once at start-up. Only UI preferences may
 * ever be stored locally, under keys listed in UI_PREFERENCE_KEYS (P5-004: the date-display preference).
 */
export const LEGACY_CASE_STORAGE_KEYS = ["investigation-store"] as const;
export const UI_PREFERENCE_KEYS: readonly string[] = ["ir.ui.date-format"];

type MinimalStorage = Pick<Storage, "getItem" | "removeItem">;

function browserStorage(): MinimalStorage | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null; // storage access can throw (privacy modes, sandboxed iframes)
  }
}

/** Removes case data left by older builds; returns the keys that were present. */
export function purgeLegacyCaseStorage(storage: MinimalStorage | null = browserStorage()): string[] {
  if (!storage) return [];
  const removed: string[] = [];
  for (const key of LEGACY_CASE_STORAGE_KEYS) {
    try {
      if (storage.getItem(key) === null) continue;
      storage.removeItem(key);
      removed.push(key);
    } catch {
      // a storage that throws holds nothing we can read either
    }
  }
  return removed;
}
