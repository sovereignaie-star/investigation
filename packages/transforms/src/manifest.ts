/**
 * P2-004 — capability manifest SDK (T-RULE-01).
 *
 * A transform is declared with `defineTransform`, which validates the manifest
 * against the `TransformManifest` schema (ADR-08 §3: every transform declares its
 * destination mode — `pinned` with a non-empty allow list, or `public` with an
 * empty one — and its network/sends/limits up front). The manifest is the
 * machine-readable contract the engine, the egress gateway and the sandbox use to
 * decide what a transform may do; it is never derived from the transform's code.
 */
import { TransformManifest as TransformManifestSchema } from "@ir/schema";
import type { TransformManifest } from "@ir/schema";
import type { TransformContext } from "./transform.ts";
import type { TransformOutput } from "./output.ts";

/** The validated manifest value (the schema package's inferred type). */
export type TransformManifestValue = TransformManifest;

/** A transform definition: its validated manifest plus the implementation. */
export interface TransformDefinition<TInput = unknown> {
  readonly manifest: TransformManifestValue;
  readonly run: (input: TInput, ctx: TransformContext) => Promise<TransformOutput>;
}

/**
 * Declare a transform. The manifest is validated eagerly so a malformed manifest
 * fails at registration time, not at run time (fail-closed, T-RULE-01).
 */
export function defineTransform<TInput>(
  manifest: unknown,
  run: (input: TInput, ctx: TransformContext) => Promise<TransformOutput>,
): TransformDefinition<TInput> {
  const parsed = TransformManifestSchema.parse(manifest);
  return { manifest: parsed, run };
}
