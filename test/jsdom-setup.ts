/**
 * P3-021: the jsdom test-environment shims. jsdom lacks browser APIs the UI uses
 * (matchMedia for the toast theme, ResizeObserver in Radix dialogs, scrollIntoView in
 * cmdk); node-environment tests never see this file's work (the window guard).
 * These are test-environment shims, not product code — behavior is not simulated.
 */
if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    window.matchMedia = (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList;
  }
  if (!("ResizeObserver" in window)) {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
  if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoViewStub(): void {};
  }
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
}
