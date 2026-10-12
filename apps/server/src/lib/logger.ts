import pino from "pino";

/**
 * Test hook (T-SEC-SSRF-047 canary): an in-process destination that, when
 * set (even AFTER this module is imported), receives the raw serialized
 * pino NDJSON lines. This lets a test assert on the ACTUAL serialized log
 * line (what would hit stdout in production) rather than only the object
 * passed to `logger.info` — proving the canary survives pino's own
 * serialization/redaction, not just our sink's shape.
 *
 * Implementation note: `pino-pretty` runs in a WORKER THREAD (its output
 * is unreachable from the test), so when `transport` is set pino IGNORES
 * the second `stream` argument. To make the hook always reachable, we use
 * a single custom `Writable` as the pino destination and drop the pretty
 * transport. Logs are NDJSON on stdout in dev (pino-pretty can still be
 * applied out-of-band: `node app.js | pino-pretty`).
 */
export interface LoggerTestHook {
  /** Receives the raw serialized pino NDJSON line (no trailing newline). */
  write?: (line: string) => void;
}

const g = globalThis as typeof globalThis & { __irLoggerTestHook?: LoggerTestHook };

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",
    redact: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"],
  },
  {
    write(line: string) {
      // When a test hook is registered, route the SERIALIZED line to it
      // (and to stdout so nothing changes for other consumers).
      g.__irLoggerTestHook?.write?.(line.replace(/\n$/, ""));
      process.stdout.write(line);
    },
  } as NodeJS.WritableStream,
);
