/* eslint-disable */
/**
 * Local runtime stand-in for `convex/_generated/api`, used ONLY by the Metro
 * bundler (see ../metro.config.js). EAS Build uploads only the `mobile/`
 * directory, so the real generated file at `../../convex/_generated/api` is
 * absent in the cloud and Metro cannot resolve the out-of-root import.
 *
 * The generated runtime is fully generic (`api = anyApi`), identical for every
 * Convex project, so this copy never needs updating. Type-checking still uses
 * the real, schema-typed `../../convex/_generated/api.d.ts` — the import paths
 * in the app are unchanged, and `tsc` resolves them against the parent locally.
 */
import { anyApi, componentsGeneric } from "convex/server";

export const api = anyApi;
export const internal = anyApi;
export const components = componentsGeneric();
