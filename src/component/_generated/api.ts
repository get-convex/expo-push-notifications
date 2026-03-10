/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as batch from "../batch.js";
import type * as expo from "../expo.js";
import type * as functions from "../functions.js";
import type * as helpers from "../helpers.js";
import type * as migrations from "../migrations.js";
import type * as notifs from "../notifs.js";
import type * as public_ from "../public.js";
import type * as shared from "../shared.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  batch: typeof batch;
  expo: typeof expo;
  functions: typeof functions;
  helpers: typeof helpers;
  migrations: typeof migrations;
  notifs: typeof notifs;
  public: typeof public_;
  shared: typeof shared;
}> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = anyApi as any;

export const components = componentsGeneric() as unknown as {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  pushNotificationWorkpool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"pushNotificationWorkpool">;
};
