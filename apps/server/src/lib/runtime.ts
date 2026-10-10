/** Resolves the safe default bind address without conflating local development and container deployment. */
export function resolveHost(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env["HOST"]?.trim();
  if (configured) return configured;
  return env["NODE_ENV"] === "production" ? "0.0.0.0" : "127.0.0.1";
}

/** Resolves and validates the TCP port shared by local and hosted startup paths. */
export function resolvePort(env: NodeJS.ProcessEnv = process.env): number {
  const port = Number(env["PORT"] ?? 8080);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid PORT value: "${env["PORT"]}"`);
  }
  return port;
}
