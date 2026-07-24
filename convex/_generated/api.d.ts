/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as books from "../books.js";
import type * as clubs from "../clubs.js";
import type * as crons from "../crons.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_clouds from "../lib/clouds.js";
import type * as lib_days from "../lib/days.js";
import type * as polls from "../polls.js";
import type * as pushups from "../pushups.js";
import type * as rollover from "../rollover.js";
import type * as setup from "../setup.js";
import type * as summaries from "../summaries.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  books: typeof books;
  clubs: typeof clubs;
  crons: typeof crons;
  "lib/access": typeof lib_access;
  "lib/clouds": typeof lib_clouds;
  "lib/days": typeof lib_days;
  polls: typeof polls;
  pushups: typeof pushups;
  rollover: typeof rollover;
  setup: typeof setup;
  summaries: typeof summaries;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  core: import("@convex-dev/auth/core/_generated/component.js").ComponentApi<"core">;
  authPasswordProvider: import("@convex-dev/auth/providers/password/_generated/component.js").ComponentApi<"authPasswordProvider">;
};
