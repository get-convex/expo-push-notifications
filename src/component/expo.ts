import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalAction } from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";

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
    });

    const inProgress = notifications.filter(
      (notification) => notification.state === "in_progress",
    );
    if (inProgress.length === 0) {
      return null;
    }

    const response = await fetch("https://exp.host/--/api/v2/push/send", {
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
    });

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
