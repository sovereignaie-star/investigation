// P3-023: the copyable error report — what a user pastes into a bug report.
// Bounded (a runaway stack must stay pasteable) and free of case data: it carries
// only the error, the route, the time and the component stack.

const MAX_STACK_CHARS = 3000;
const MAX_COMPONENT_STACK_CHARS = 1500;

export interface ErrorReportContext {
  path: string;
  at: Date;
  componentStack: string;
}

/** A human-readable one-line summary of anything that can be thrown. */
export function describeThrown(thrown: unknown): string {
  if (thrown instanceof Error) return `${thrown.name}: ${thrown.message}`;
  if (typeof thrown === "string") return thrown;
  try {
    return JSON.stringify(thrown) ?? String(thrown);
  } catch {
    return String(thrown);
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n… [truncated]` : text;
}

/** Builds the report text for a caught error. */
export function buildErrorReport(thrown: unknown, ctx: ErrorReportContext): string {
  const lines = [`${describeThrown(thrown)}`, `route: ${ctx.path}`, `time: ${ctx.at.toISOString()}`];
  if (thrown instanceof Error && thrown.stack) lines.push("", clip(thrown.stack, MAX_STACK_CHARS));
  if (ctx.componentStack.trim()) lines.push("", "component stack:", clip(ctx.componentStack.trim(), MAX_COMPONENT_STACK_CHARS));
  return lines.join("\n");
}
