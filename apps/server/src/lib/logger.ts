import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

// D-8 enforcement test [P1-031]: this file is in the apps/server/ code-owner path.
// Do not merge this branch to main; it exists to test the D-8 mechanism only.

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
// D-8 review request test comment [P1-031]
// Phase 2: NEW commit AFTER approval — this must DISMISS the stale review [P1-031]
