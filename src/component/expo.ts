import { v } from "convex/values";
import { RateLimiter } from "@convex-dev/rate-limiter";
import type { ComponentApi as RateLimiterComponentApi } from "@convex-dev/rate-limiter/_generated/component.js";
import { components, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { internalAction } from "./functions.js";
import { EXPO_ONE_CALL_EVERY_MS } from "./shared.js";

const vSendResult = v.union(
  v.null(),
  v.object({
    kind: v.literal("success"),
    notifications: v.array(
      v.object({
        id: v.id("notifications"),
        state: v.union(
          v.literal("delivered"),
          v.literal("failed"),
          v.literal("needs_retry"),
        ),
        errorMessage: v.optional(v.string()),
        errorCode: v.optional(v.string()),
        expoTicketId: v.optional(v.string()),
      }),
    ),
  }),
);

function isRetryableExpoTicketError(errorCode?: string) {
  return errorCode === "MessageRateExceeded";
}

const componentRefs: {
  rateLimiter: RateLimiterComponentApi<"rateLimiter">;
} = components;

const expoApiRateLimiter = new RateLimiter(componentRefs.rateLimiter, {
  expoApi: {
    kind: "fixed window",
    period: EXPO_ONE_CALL_EVERY_MS,
    rate: 1,
  },
});
const EXPO_REQUEST_TIMEOUT_MS = 30_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const callExpoPushApiWithBatch = internalAction({
  args: { notificationIds: v.array(v.id("notifications")) },
  returns: vSendResult,
  handler: async (ctx, args) => {
    const notifications: Array<{
      _id: Id<"notifications">;
      token: string;
      metadata: any;
      state: string;
      numPreviousFailures: number;
    }> = await ctx.runQuery(internal.notifs.getNotificationsByIds, {
      notificationIds: args.notificationIds,
      logLevel: ctx.logger.level,
    });

    const inProgress = notifications.filter(
      (notification) => notification.state === "in_progress",
    );
    if (inProgress.length === 0) {
      return null;
    }

    const limit = await expoApiRateLimiter.limit(ctx, "expoApi", {
      reserve: true,
    });
    if (limit.retryAfter) {
      await sleep(limit.retryAfter);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, EXPO_REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          inProgress.map((notification) => ({
            to: notification.token,
            ...notification.metadata,
          })),
        ),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `Expo API request timed out after ${EXPO_REQUEST_TIMEOUT_MS}ms`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(
        `Expo API error: ${response.status} ${response.statusText} ${await response.text()}`,
      );
    }

    const responseBody: {
      data: Array<
        | { status: "ok"; id: string }
        | {
            status: "error";
            message?: string;
            details?: {
              error?: string;
            };
          }
      >;
    } = await response.json();

    if (!responseBody?.data || !Array.isArray(responseBody.data)) {
      throw new Error("Invalid response from Expo API");
    }
    if (responseBody.data.length !== inProgress.length) {
      throw new Error(
        `Invalid response from Expo API: expected ${inProgress.length} results, got ${responseBody.data.length}`,
      );
    }

    return {
      kind: "success",
      notifications: inProgress.map((notification, idx) => {
        const item = responseBody.data[idx];
        if (item?.status === "ok") {
          return {
            id: notification._id,
            state: "delivered" as const,
            expoTicketId: item.id,
          };
        }
        return {
          id: notification._id,
          state: isRetryableExpoTicketError(item?.details?.error)
            ? ("needs_retry" as const)
            : ("failed" as const),
          errorMessage: item?.message ?? "Unknown Expo error",
          errorCode: item?.details?.error,
        };
      }),
    } as const;
  },
});
