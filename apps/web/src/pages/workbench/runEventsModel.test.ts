import { describe, expect, it } from "vitest";

import { readSseStream, type SseEvent } from "./runEventsModel";

/**
 * P3-011: the SSE wire reader for run phase events. EventSource cannot send the
 * admin Authorization header (the engine routes are behind requireAdmin), so the
 * browser reads `text/event-stream` with fetch + a streaming reader. These tests
 * exercise the REAL byte path: ReadableStream<Uint8Array> chunks through a
 * TextDecoder in streaming mode — including an Arabic payload split mid-codepoint
 * across chunks, which a string-only parser test would never catch.
 */

function streamFrom(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

function streamFromBytes(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

async function collect(chunks: readonly string[]): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  await readSseStream(streamFrom(chunks), (e) => events.push(e));
  return events;
}

describe("readSseStream (P3-011)", () => {
  it("parses event/data pairs and ignores comment lines", async () => {
    const events = await collect([
      'event: phase\ndata: {"runId":"r1","phase":"queued"}\n\n',
      ": keepalive\n\n",
      'event: phase\ndata: {"runId":"r1","phase":"running"}\n\n',
    ]);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ event: "phase", data: '{"runId":"r1","phase":"queued"}' });
    expect(events[1]).toEqual({ event: "phase", data: '{"runId":"r1","phase":"running"}' });
  });

  it("reassembles an event split across chunk boundaries", async () => {
    const events = await collect(["event: pha", 'se\ndata: {"runId":"r1"', ',"phase":"succeeded"}\n\n']);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ event: "phase", data: '{"runId":"r1","phase":"succeeded"}' });
  });

  it("joins multi-line data fields with newlines", async () => {
    const events = await collect(["event: phase\ndata: line1\ndata: line2\n\n"]);
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toBe("line1\nline2");
  });

  it("decodes an Arabic payload split mid-codepoint across chunks (real byte path)", async () => {
    const payload = `event: phase\ndata: {"phase":"جارٍ التشغيل"}\n\n`;
    const bytes = new TextEncoder().encode(payload);
    // Split inside the Arabic text: find a byte offset whose continuation bytes
    // straddle a codepoint boundary (any cut inside a multi-byte char works).
    const cut = bytes.indexOf(0xd8) + 3; // inside the first Arabic letter
    const events: SseEvent[] = [];
    await readSseStream(streamFromBytes([bytes.slice(0, cut), bytes.slice(cut)]), (e) => events.push(e));
    expect(events).toHaveLength(1);
    const first = events[0];
    if (!first) throw new Error("event missing");
    expect(first.event).toBe("phase");
    expect(JSON.parse(first.data)).toEqual({ phase: "جارٍ التشغيل" });
  });

  it("drops an incomplete trailing block — the server closed mid-event (connection lost, not success)", async () => {
    const events = await collect([
      'event: phase\ndata: {"runId":"r1","phase":"running"}\n\n',
      'event: phase\ndata: {"runId":"r1","phase":"succe',
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toContain("running");
  });
});
