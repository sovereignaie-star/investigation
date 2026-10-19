/**
 * P3-011 (تقدم التشغيل الحي): the SSE wire reader for run phase events. The
 * engine routes sit behind requireAdmin, and EventSource cannot send an
 * Authorization header — so the browser reads `text/event-stream` with fetch
 * and a streaming reader that sends the admin token.
 *
 * Pure parsing over the REAL byte path: chunks arrive as Uint8Array and are
 * decoded with a streaming TextDecoder, so a payload split mid-codepoint across
 * chunks (an Arabic phase label, for instance) is reassembled correctly. No
 * network code lives here — the caller supplies the ReadableStream.
 */

export interface SseEvent {
  /** The `event:` field (defaults to "message" per the SSE wire format). */
  event: string;
  /** The `data:` fields joined with newlines. */
  data: string;
}

/**
 * Reads an SSE body to completion, dispatching every complete event block. An
 * incomplete trailing block (the connection dropped mid-event) is DROPPED —
 * the caller must treat a stream that ended without a terminal event as a lost
 * connection, never as success.
 */
export async function readSseStream(body: ReadableStream<Uint8Array>, onEvent: (e: SseEvent) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (;;) {
      const sep = buffer.indexOf("\n\n");
      if (sep === -1) break;
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const parsed = parseSseBlock(block);
      if (parsed) onEvent(parsed);
    }
  }
  // Flush the decoder (a split codepoint at the very end of the stream), then
  // discard any incomplete trailing block — it never formed a full event and
  // must NOT be dispatched (a connection that dropped mid-event is not success).
  buffer += decoder.decode();
  if (!buffer.endsWith("\n\n")) return;
}

/**
 * Parses one complete SSE block (the text between two \n\n separators). Comment
 * lines (starting with `:`) are ignored; `event:` and `data:` fields are
 * collected; a block with no data dispatches nothing (SSE rule).
 */
export function parseSseBlock(block: string): SseEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const rawLine of block.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim();
    let value = line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

/**
 * Opens the run's phase-event stream with the admin token (fetch, because
 * EventSource cannot send headers). Returns the Response; feed `res.body` to
 * readSseStream. The caller owns aborting the connection (AbortController).
 */
export async function openRunEvents(baseUrl: string, runId: string, token: string, signal: AbortSignal): Promise<Response> {
  return await fetch(`${baseUrl}/runs/${runId}/events`, {
    headers: { authorization: `Bearer ${token}` },
    signal,
  });
}
