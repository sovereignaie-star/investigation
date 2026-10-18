import { describe, expect, it } from "vitest";
import { Button } from "@ir/ui";

// P3-001 acceptance: apps/web consumes @ir/ui (the component library no longer
// lives only inside the mockup-sandbox dev tool — defect D-043).
describe("apps/web consumes @ir/ui (P3-001)", () => {
  it("imports Button from @ir/ui", () => {
    expect(Button).toBeDefined();
  });
});
