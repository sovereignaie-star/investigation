import { describe, expect, it } from "vitest";
// P3-003 (طلب أ): the generated client must expose the case lifecycle operations the spec
// defines — this is the contract between the OpenAPI spec and the SDK the web app uses.
import * as client from "./index";

describe("generated client: case operations (P3-003)", () => {
  it("exposes listCases, getCase, createCase and updateCaseLifecycle", () => {
    for (const name of ["listCases", "getCase", "createCase", "updateCaseLifecycle"] as const) {
      expect(typeof (client as unknown as Record<string, unknown>)[name], name).toBe("function");
    }
  });

  it("exposes the react-query hooks for the case operations", () => {
    for (const name of ["useListCases", "useGetCase", "useCreateCase", "useUpdateCaseLifecycle"] as const) {
      expect(typeof (client as unknown as Record<string, unknown>)[name], name).toBe("function");
    }
  });
});
