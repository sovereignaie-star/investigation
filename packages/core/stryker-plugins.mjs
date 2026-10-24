/**
 * P6-005: Stryker plugin shim for pnpm workspaces. Stryker's default plugin glob
 * ("@stryker-mutator/*") resolves from its own .pnpm location, which under pnpm
 * never contains the runner — this shim re-exports the vitest runner so the
 * explicit "./stryker-plugins.mjs" descriptor resolves portably from this package.
 */
export { strykerPlugins, strykerValidationSchema } from "@stryker-mutator/vitest-runner";
