// @ir/organs (P4-024, ADR-32): the three organs of the project and their registry.
import { countermeasures } from "./countermeasures/index";
import { investigation } from "./investigation/index";
import { prevention } from "./prevention/index";
import type { Organ, OrganId } from "./types";

export type { ForbiddenCapability, Organ, OrganId, OrganMaturity } from "./types";

/** The three organs, in their canonical order: prevent, investigate, counter. */
export const ORGANS: readonly Organ[] = [prevention, investigation, countermeasures];

/** The organ with this id; an unknown id throws (never `undefined`). */
export function getOrgan(id: OrganId): Organ {
  const organ = ORGANS.find((o) => o.id === id);
  if (!organ) throw new Error(`unknown organ: ${String(id)}`);
  return organ;
}
