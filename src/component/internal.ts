import { v } from "convex/values";
import { internalAction, internalMutation } from "./functions.js";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { ensureCoordinator } from "./helpers.js";
import { notificationFields } from "./schema.js";
import type {
  ExpoPushSuccessTicket,
  ExpoPushErrorTicket,
} from "expo-server-sdk";

export const markNotificationState = internalMutation({
  args: {
    notifications: v.array(
      v.object({
        _id: v.id("notifications"),
        state: v.union(
          v.literal("delivered"),
          v.literal("failed"),
          v.literal("maybe_delivered"),
        ),
      }),
    ),
    checkJobId: v.id("_scheduled_functions"),
  },
  handler: async (ctx, { notifications, checkJobId }) => {
    ctx.logger.debug(`Marking state for ${notifications.length} notifications`);
    for (const notification of notifications) {
      const { _id, state } = notification;
      switch (state) {
        case "delivered":
          ctx.logger.debug(`Marking notification ${_id} as delivered`);
          await ctx.db.patch(_id, {
            state: "delivered",
          });
          break;
        case "failed": {
          ctx.logger.debug(`Marking notification ${_id} as needing retry`);
          const notification = await ctx.db.get(_id);
          await ctx.db.patch(_id, {
            state: "needs_retry",
            numPreviousFailures: notification!.numPreviousFailures + 1,
          });
          break;
        }
        case "maybe_delivered":
          ctx.logger.debug(`Marking notification ${_id} as maybe delivered`);
          await ctx.db.patch(_id, {
            state: "maybe_delivered",
          });
      }
    }
    ctx.logger.debug(`Cancelling scheduled check ${checkJobId}`);
    await ctx.scheduler.cancel(checkJobId);
    await ensureCoordinator(ctx);
  },
});

const MAX_NOTIFICATIONS_PER_SEND = 100;
const MAX_SENDERS = 10;
const MAX_SENDER_DURATION_MS = 10_000;
const MAX_RETRY_ATTEMPTS = 5;

export const coordinateSendingPushNotifications = internalMutation({
  args: {},
  handler: async (ctx) => {
    ctx.logger.debug("Coordinate sending push notifications");
    // Get notifications
    const retryNotifications = await ctx.db
      .query("notifications")
      .withIndex("state", (q) => q.eq("state", "needs_retry"))
      .take(MAX_NOTIFICATIONS_PER_SEND);
    const unsentNotifications = await ctx.db
      .query("notifications")
      .withIndex("state", (q) => q.eq("state", "awaiting_delivery"))
      .take(MAX_NOTIFICATIONS_PER_SEND - retryNotifications.length);
    ctx.logger.debug(
      `Found ${retryNotifications.length} retry notifications and ${unsentNotifications.length} unsent notifications`,
    );
    const notificationsToProcess = [
      ...retryNotifications,
      ...unsentNotifications,
    ];
    if (notificationsToProcess.length === 0) {
      // Nothing to do!
      ctx.logger.info("No notifications to send, doing nothing");
      return;
    }

    const senders = await ctx.db.query("senders").collect();
    let numActiveSenders = 0;
    for (const sender of senders) {
      const senderJob = await ctx.db.system.get(sender.jobId);
      if (
        senderJob?.state.kind === "inProgress" ||
        senderJob?.state.kind === "pending"
      ) {
        numActiveSenders++;
      } else {
        ctx.logger.debug(`Removing sender in state ${senderJob?.state.kind}`);
        await ctx.db.delete(sender._id);
      }
    }
    ctx.logger.debug(`Found ${numActiveSenders} active senders`);
    if (numActiveSenders >= MAX_SENDERS) {
      // Don't add another sender yet
      ctx.logger.debug(
        `Not starting another sender: already ${numActiveSenders}`,
      );
      ctx.logger.debug(
        `When one sender finishes, or fails, we'll coordinate sending these notifications.`,
      );
      return;
    }
    const notificationsToSend = notificationsToProcess.filter(
      (n) => n.numPreviousFailures < MAX_RETRY_ATTEMPTS,
    );
    const notificationsToMarkAsUnableToDeliver = notificationsToProcess.filter(
      (n) => n.numPreviousFailures >= MAX_RETRY_ATTEMPTS,
    );

    for (const notification of notificationsToMarkAsUnableToDeliver) {
      if (notification.numPreviousFailures >= MAX_RETRY_ATTEMPTS) {
        await ctx.db.patch(notification._id, {
          state: "unable_to_deliver",
        });
      }
    }
    for (const notification of notificationsToSend) {
      await ctx.db.patch(notification._id, {
        state: "in_progress",
      });
    }
    ctx.logger.debug(`Marking all notifications as in progress`);
    const checkJobId = await ctx.scheduler.runAfter(
      MAX_SENDER_DURATION_MS,
      internal.internal.checkForFailedAction,
      {
        notificationIds: notificationsToSend.map((n) => n._id),
        logLevel: ctx.logger.level,
      },
    );

    const senderJobId = await ctx.scheduler.runAfter(
      0,
      internal.internal.action_sendPushNotifications,
      {
        checkJobId,
        notifications: notificationsToSend.map((n) => {
          return {
            message: {
              to: n.token,
              _contentAvailable: n.metadata._contentAvailable ?? undefined,
              data: n.metadata.data ?? undefined,
              title: n.metadata.title,
              body: n.metadata.body ?? undefined,
              ttl: n.metadata.ttl ?? undefined,
              expiration: n.metadata.expiration ?? undefined,
              priority: n.metadata.priority ?? undefined,
              subtitle: n.metadata.subtitle ?? undefined,
              sound: n.metadata.sound ?? undefined,
              badge: n.metadata.badge ?? undefined,
              interruptionLevel: n.metadata.interruptionLevel ?? undefined,
              channelId: n.metadata.channelId ?? undefined,
              icon: n.metadata.icon ?? undefined,
              richContent: n.metadata.richContent ?? undefined,
              categoryId: n.metadata.categoryId ?? undefined,
              mutableContent: n.metadata.mutableContent ?? undefined,
            },
            _id: n._id,
          };
        }),
        logLevel: ctx.logger.level,
      },
    );
    await ctx.db.insert("senders", {
      jobId: senderJobId,
      checkJobId,
    });
    ctx.logger.debug(
      `Started a new sender ${senderJobId} with job ${senderJobId} and check job ${checkJobId}`,
    );
  },
});

export const checkForFailedAction = internalMutation({
  args: {
    notificationIds: v.array(v.id("notifications")),
  },
  handler: async (ctx, { notificationIds }) => {
    console.warn(
      `Could not determine delivery status for ${notificationIds.length} notifications:`,
      notificationIds,
    );
    for (const notificationId of notificationIds) {
      // We don't really know what happened to these notifications,
      // so we can't safely retry these.
      await ctx.db.patch(notificationId as Id<"notifications">, {
        state: "maybe_delivered",
      });
    }
    await ensureCoordinator(ctx);
  },
});

export const action_sendPushNotifications = internalAction({
  args: {
    checkJobId: v.id("_scheduled_functions"),
    notifications: v.array(
      v.object({
        message: v.object({
          to: v.string(),
          ...notificationFields,
        }),
        _id: v.id("notifications"),
      }),
    ),
  },
  handler: async (ctx, args) => {
    ctx.logger.debug(
      `Sending ${args.notifications.length} push notifications via Expo's API`,
    );
    ctx.logger.debug(
      `Notification IDs: ${JSON.stringify(args.notifications.map((n) => n._id))}`,
    );
    let response: Response;
    try {
      // https://docs.expo.dev/push-notifications/sending-notifications/#http2-api
      response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args.notifications.map((n) => n.message)),
      });
    } catch (_e) {
      ctx.logger.error(
        "Failed during during fetch for sending push notifications:",
        _e,
      );
      ctx.logger.debug(
        `Marking ${args.notifications.length} notifications as failed so they can be retried`,
      );
      await ctx.runMutation(internal.internal.markNotificationState, {
        notifications: args.notifications.map((n) => {
          return {
            _id: n._id,
            // It's unlikely that the notifications were actually delivered
            // if the fetch failed, so we mark them as failed.
            state: "failed" as const,
          };
        }),
        checkJobId: args.checkJobId,
        logLevel: ctx.logger.level,
      });
      return;
    }
    if (!response.ok) {
      ctx.logger.warn(
        `Push notification failed with status ${response.status} and body ${await response.text()}`,
      );
      ctx.logger.debug(
        `Marking ${args.notifications.length} notifications as maybe delivered. They won't be retried.`,
      );
      await ctx.runMutation(internal.internal.markNotificationState, {
        notifications: args.notifications.map((n) => {
          return {
            _id: n._id,
            // We don't really know what happened to these notifications,
            // so we mark them as maybe_delivered, so we don't retry them
            // again and again.
            state: "maybe_delivered" as const,
          };
        }),
        checkJobId: args.checkJobId,
        logLevel: ctx.logger.level,
      });
      return;
    }
    const responseBody: {
      data: Array<ExpoPushSuccessTicket | ExpoPushErrorTicket>;
    } = await response.json();
    ctx.logger.debug(
      `Response from Expo's API: ${JSON.stringify(responseBody)}`,
    );

    const notificationStates: Array<{
      _id: Id<"notifications">;
      state: "delivered" | "maybe_delivered" | "failed";
    }> = [];
    for (let idx = 0; idx < args.notifications.length; idx++) {
      const notification = args.notifications[idx];
      const responseItem = responseBody.data[idx];
      if (responseItem && responseItem.status === "ok") {
        notificationStates.push({
          _id: notification._id,
          state: "delivered",
        });
      } else {
        notificationStates.push({
          _id: notification._id,
          state: "failed",
        });
      }
    }
    ctx.logger.debug(
      `Successfully parsed response from Expo, and recording state`,
    );
    await ctx.runMutation(internal.internal.markNotificationState, {
      notifications: notificationStates,
      checkJobId: args.checkJobId,
      logLevel: ctx.logger.level,
    });
  },
});
