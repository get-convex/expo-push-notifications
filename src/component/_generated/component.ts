/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    public: {
      deleteNotificationsForUser: FunctionReference<
        "mutation",
        "internal",
        { logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR"; userId: string },
        null,
        Name
      >;
      getNotification: FunctionReference<
        "query",
        "internal",
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
          richContent?: { audio?: string; image?: string; video?: string };
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
        },
        Name
      >;
      getNotificationsForUser: FunctionReference<
        "query",
        "internal",
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
          richContent?: { audio?: string; image?: string; video?: string };
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
        }>,
        Name
      >;
      getStatusForUser: FunctionReference<
        "query",
        "internal",
        { logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR"; userId: string },
        { hasToken: boolean; paused: boolean },
        Name
      >;
      pauseNotificationsForUser: FunctionReference<
        "mutation",
        "internal",
        { logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR"; userId: string },
        null,
        Name
      >;
      recordPushNotificationToken: FunctionReference<
        "mutation",
        "internal",
        {
          logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR";
          pushToken: string;
          userId: string;
        },
        null,
        Name
      >;
      removePushNotificationToken: FunctionReference<
        "mutation",
        "internal",
        { logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR"; userId: string },
        null,
        Name
      >;
      restart: FunctionReference<
        "mutation",
        "internal",
        { logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR" },
        boolean,
        Name
      >;
      sendPushNotification: FunctionReference<
        "mutation",
        "internal",
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
            richContent?: { audio?: string; image?: string; video?: string };
            sound?: string | null;
            subtitle?: string;
            title?: string;
            ttl?: number;
          };
          userId: string;
        },
        string | null,
        Name
      >;
      sendPushNotificationBatch: FunctionReference<
        "mutation",
        "internal",
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
              richContent?: { audio?: string; image?: string; video?: string };
              sound?: string | null;
              subtitle?: string;
              title?: string;
              ttl?: number;
            };
            userId: string;
          }>;
        },
        Array<string | null>,
        Name
      >;
      shutdown: FunctionReference<
        "mutation",
        "internal",
        { logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR" },
        { data?: any; message: string },
        Name
      >;
      unpauseNotificationsForUser: FunctionReference<
        "mutation",
        "internal",
        { logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR"; userId: string },
        null,
        Name
      >;
    };
  };
