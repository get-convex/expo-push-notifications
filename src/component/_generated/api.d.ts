/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as functions from "../functions.js";
import type * as helpers from "../helpers.js";
import type * as internal_ from "../internal.js";
import type * as public_ from "../public.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  functions: typeof functions;
  helpers: typeof helpers;
  internal: typeof internal_;
  public: typeof public_;
}>;
export type Mounts = {
  public: {
    deleteNotificationsForUser: FunctionReference<
      "mutation",
      "public",
      { logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR"; userId: string },
      any
    >;
    getNotification: FunctionReference<
      "query",
      "public",
      { id: string; logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR" },
      null | {
        _contentAvailable?: boolean;
        _creationTime: number;
        badge?: number;
        body?: string;
        categoryId?: string;
        channelId?: string;
        data?: any;
        expiration?: number;
        interruptionLevel?:
          | "active"
          | "critical"
          | "passive"
          | "time-sensitive";
        mutableContent?: boolean;
        numPreviousFailures: number;
        priority?: "default" | "normal" | "high";
        sound?: string | null;
        state:
          | "awaiting_delivery"
          | "in_progress"
          | "delivered"
          | "needs_retry"
          | "failed"
          | "maybe_delivered"
          | "unable_to_deliver";
        subtitle?: string;
        title?: string;
        ttl?: number;
      }
    >;
    getNotificationsForUser: FunctionReference<
      "query",
      "public",
      {
        limit?: number;
        logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR";
        userId: string;
      },
      Array<{
        _contentAvailable?: boolean;
        _creationTime: number;
        badge?: number;
        body?: string;
        categoryId?: string;
        channelId?: string;
        data?: any;
        expiration?: number;
        id: string;
        interruptionLevel?:
          | "active"
          | "critical"
          | "passive"
          | "time-sensitive";
        mutableContent?: boolean;
        numPreviousFailures: number;
        priority?: "default" | "normal" | "high";
        sound?: string | null;
        state:
          | "awaiting_delivery"
          | "in_progress"
          | "delivered"
          | "needs_retry"
          | "failed"
          | "maybe_delivered"
          | "unable_to_deliver";
        subtitle?: string;
        title?: string;
        ttl?: number;
      }>
    >;
    getStatusForUser: FunctionReference<
      "query",
      "public",
      { logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR"; userId: string },
      { hasToken: boolean; paused: boolean }
    >;
    pauseNotificationsForUser: FunctionReference<
      "mutation",
      "public",
      { logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR"; userId: string },
      null
    >;
    recordPushNotificationToken: FunctionReference<
      "mutation",
      "public",
      {
        logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR";
        pushToken: string;
        userId: string;
      },
      null
    >;
    removePushNotificationToken: FunctionReference<
      "mutation",
      "public",
      { logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR"; userId: string },
      null
    >;
    restart: FunctionReference<
      "mutation",
      "public",
      { logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR" },
      boolean
    >;
    sendPushNotification: FunctionReference<
      "mutation",
      "public",
      {
        allowUnregisteredTokens?: boolean;
        logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR";
        notification: {
          _contentAvailable?: boolean;
          badge?: number;
          body?: string;
          categoryId?: string;
          channelId?: string;
          data?: any;
          expiration?: number;
          interruptionLevel?:
            | "active"
            | "critical"
            | "passive"
            | "time-sensitive";
          mutableContent?: boolean;
          priority?: "default" | "normal" | "high";
          sound?: string | null;
          subtitle?: string;
          title?: string;
          ttl?: number;
        };
        userId: string;
      },
      string | null
    >;
    sendPushNotificationBatch: FunctionReference<
      "mutation",
      "public",
      {
        allowUnregisteredTokens?: boolean;
        logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR";
        notifications: Array<{
          notification: {
            _contentAvailable?: boolean;
            badge?: number;
            body?: string;
            categoryId?: string;
            channelId?: string;
            data?: any;
            expiration?: number;
            interruptionLevel?:
              | "active"
              | "critical"
              | "passive"
              | "time-sensitive";
            mutableContent?: boolean;
            priority?: "default" | "normal" | "high";
            sound?: string | null;
            subtitle?: string;
            title?: string;
            ttl?: number;
          };
          userId: string;
        }>;
      },
      Array<string | null>
    >;
    shutdown: FunctionReference<
      "mutation",
      "public",
      { logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR" },
      { data?: any; message: string }
    >;
    unpauseNotificationsForUser: FunctionReference<
      "mutation",
      "public",
      { logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR"; userId: string },
      null
    >;
  };
};
// For now fullApiWithMounts is only fullApi which provides
// jump-to-definition in component client code.
// Use Mounts for the same type without the inference.
declare const fullApiWithMounts: typeof fullApi;

export declare const api: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "internal">
>;

export declare const components: {};
