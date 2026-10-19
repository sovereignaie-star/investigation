import { handleLayoutRequest, type LayoutRequest } from "./layoutProtocol";

/**
 * P3-007: the layout Web Worker shell. ForceAtlas2 runs off the main thread (ROADMAP 5.11:
 * "ForceAtlas2 في Web Worker"). The protocol itself lives in `layoutProtocol.ts` (pure).
 */

self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  if (event.data?.type !== "layout") return;
  try {
    (self as unknown as Worker).postMessage(handleLayoutRequest(event.data));
  } catch (e) {
    (self as unknown as Worker).postMessage({
      type: "layout-error",
      message: e instanceof Error ? e.message : String(e),
    });
  }
};
