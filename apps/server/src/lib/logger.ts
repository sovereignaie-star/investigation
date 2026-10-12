import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino";

/**
 * Server logger (P1-024, P2-003).
 *
 * `LOGGER_OPTIONS` is the single source of the production log configuration (level and redaction). `createLogger`
 * builds a logger from exactly these options with an explicit destination, so a test can capture the SERIALIZED
 * NDJSON lines that the production configuration would write (T-SEC-SSRF-047 canary) without any hook in the
 * production module.
 *
 * Behaviour by environment:
 * - production (`NODE_ENV=production`): NDJSON to stdout through pino's default destination.
 * - tests (`VITEST` set): NDJSON to stdout, no worker thread (pino-pretty would run in a worker and make output
 *   unreachable and noisy in test runs).
 * - development (anything else): pretty-printed through the pino-pretty transport, as before.
 */
export const LOGGER_OPTIONS: Readonly<LoggerOptions> = Object.freeze({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"],
});

/** A logger with the production options writing to `destination`. */
export function createLogger(destination?: DestinationStream): Logger {
  return destination ? pino({ ...LOGGER_OPTIONS }, destination) : pino({ ...LOGGER_OPTIONS });
}

function defaultLogger(): Logger {
  const isProduction = process.env.NODE_ENV === "production";
  const isTest = process.env.VITEST !== undefined;
  if (isProduction || isTest) return createLogger();
  return pino({ ...LOGGER_OPTIONS, transport: { target: "pino-pretty", options: { colorize: true } } });
}

export const logger: Logger = defaultLogger();
