// P3-010: the evidence-viewer model — pure classification and display building.
// The security contract (ROADMAP 5.6, evidence-injection row): external HTML renders sanitized
// (DOMPurify) inside an isolated iframe; textual evidence renders as text; binary evidence
// is refused honestly instead of corrupted. The sanitizer is injected so the model is fully
// testable in node; the browser wiring passes DOMPurify. The envelope's `encoding` is the
// authority: a binary payload stays binary no matter what the mime claims.
import { isTextualMime } from "@ir/schema";

export type EvidenceMimeKind = "html" | "text" | "binary";

/** How much raw text the viewer renders — beyond this the display truncates (honestly marked). */
export const TEXT_DISPLAY_LIMIT = 100_000;

/**
 * The evidence document renders under this CSP: no network egress at all (G-11 — the shipped UI
 * connects to no origin but the server; an <img> beacon inside hostile evidence is not exempt).
 * Inline styles stay (DOMPurify already vetted them); data: images stay. It is pinned BEFORE the
 * sanitized body so it governs everything the sanitizer kept.
 */
const EVIDENCE_CSP =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'\">";

/** What a submit does: a NEW pair runs a fresh query; the SAME pair must refetch (a corrected
 * admin token changes nothing in the query key, so without this the view would keep the 401). */
export interface SubmitTarget {
  caseId: string;
  evidenceId: string;
}

export function submitDecision(target: SubmitTarget | null, form: SubmitTarget): { target: SubmitTarget | null; refetch: boolean } {
  const next =
    form.caseId.trim() !== "" && form.evidenceId.trim() !== "" ? { caseId: form.caseId.trim(), evidenceId: form.evidenceId.trim() } : null;
  const same = next !== null && target !== null && next.caseId === target.caseId && next.evidenceId === target.evidenceId;
  return { target: next, refetch: same };
}

/** An error must not leave stale content on screen — react-query keeps the last good data, so
 * the view renders only when the request is not in an error state. */
export function displayOn(isError: boolean, hasData: boolean): boolean {
  return !isError && hasData;
}

/** HTML renders in the sanitized iframe; textual non-HTML renders as text; the rest is binary. */
export function classifyMime(mime: string): EvidenceMimeKind {
  const base = mime.trim().toLowerCase().split(";")[0]?.trim() ?? "";
  if (base === "text/html" || base.endsWith("+html")) return "html";
  return isTextualMime(base) ? "text" : "binary";
}

export type EvidenceView =
  { kind: "html"; body: string } | { kind: "text"; body: string; truncated: boolean } | { kind: "binary"; mime: string; size: number };

export interface EvidenceViewInput {
  mime: string;
  /** The envelope encoding: "utf-8" (content decoded) or "binary" (content refused). */
  encoding: string;
  content: string;
  size?: number;
}

export interface EvidenceViewDeps {
  /** The HTML sanitizer (DOMPurify in the browser) — applied to the FULL document, never truncated first. */
  sanitize: (html: string) => string;
}

export function buildEvidenceView(input: EvidenceViewInput, deps: EvidenceViewDeps): EvidenceView {
  // The transport already refused binary content — the display never second-guesses it.
  if (input.encoding === "binary") {
    return { kind: "binary", mime: input.mime, size: input.size ?? 0 };
  }
  const classified = classifyMime(input.mime);
  if (classified === "binary") {
    // Text-transported but non-textual mime (or empty): refuse honestly rather than render noise.
    return { kind: "binary", mime: input.mime, size: input.size ?? 0 };
  }
  if (classified === "html") {
    // The sanitizer sees the full document — truncating before sanitizing could cut a tag open.
    // The CSP is pinned in front of the sanitized body: the page can never load a foreign resource.
    return { kind: "html", body: `${EVIDENCE_CSP}${deps.sanitize(input.content)}` };
  }
  if (input.content.length <= TEXT_DISPLAY_LIMIT) {
    return { kind: "text", body: input.content, truncated: false };
  }
  return { kind: "text", body: input.content.slice(0, TEXT_DISPLAY_LIMIT), truncated: true };
}
