import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { internalQuery } from "./functions.js";
import { FINALIZED_EPOCH } from "./schema.js";
import {
  MESSAGE_RETRY_BACKOFF_BASE,
  MAX_MESSAGE_RETRY_DELAY_MS,
  getSegment,
  getFutureSegment,
  type RuntimeConfig,
} from "./shared.js";

export const getNotificationsByIds = internalQuery({
  args: { notificationIds: v.array(v.id("notifications")) },
  returns: v.array(
    v.object({
      _id: v.id("notifications"),
      token: v.string(),
      metadata: v.any(),
      state: v.string(),
      numPreviousFailures: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const notifications = await Promise.all(
      args.notificationIds.map((id) => ctx.db.get(id)),
    );
    return notifications
      .filter((n): n is Doc<"notifications"> => n !== null)
      .map((n) => ({
        _id: n._id,
        token: n.token,
        metadata: n.metadata,
        state: n.state,
        numPreviousFailures: n.numPreviousFailures,
      }));
  },
});

function getEffectiveSegment(
  segment: number | undefined,
  fallbackSegment: number,
) {
  return typeof segment === "number" ? segment : fallbackSegment;
}

export async function getEarliestPendingNotificationSegment(
  ctx: QueryCtx | MutationCtx,
  fallbackSegment: number,
) {
  const [retryNotification, awaitingNotification] = await Promise.all([
    ctx.db
      .query("notifications")
      .withIndex("by_state_segment", (q) => q.eq("state", "needs_retry"))
      .first(),
    ctx.db
      .query("notifications")
      .withIndex("by_state_segment", (q) =>
        q.eq("state", "awaiting_delivery"),
      )
      .first(),
  ]);

  if (!retryNotification && !awaitingNotification) {
    return null;
  }
  if (!retryNotification) {
    return getEffectiveSegment(awaitingNotification!.segment, fallbackSegment);
  }
  if (!awaitingNotification) {
    return getEffectiveSegment(retryNotification.segment, fallbackSegment);
  }
  return Math.min(
    getEffectiveSegment(retryNotification.segment, fallbackSegment),
    getEffectiveSegment(awaitingNotification.segment, fallbackSegment),
  );
}

export async function getEligibleNotificationsForBatch(
  ctx: QueryCtx | MutationCtx,
  segment: number,
  batchSize: number,
) {
  const retryNotifications = await ctx.db
    .query("notifications")
    .withIndex("by_state_segment", (q) =>
      q.eq("state", "needs_retry").lte("segment", segment),
    )
    .take(batchSize);

  const unsentNotifications = await ctx.db
    .query("notifications")
    .withIndex("by_state_segment", (q) =>
      q.eq("state", "awaiting_delivery").lte("segment", segment),
    )
    .take(batchSize - retryNotifications.length);

  return [...retryNotifications, ...unsentNotifications];
}

export async function finalizeExhaustedAndReturnDeliverableNotifications(
  ctx: MutationCtx,
  notifications: Doc<"notifications">[],
  retryAttempts: number,
) {
  const notificationsToSend: Doc<"notifications">[] = [];

  for (const notification of notifications) {
    if (notification.numPreviousFailures >= retryAttempts) {
      await ctx.db.patch(notification._id, {
        state: "unable_to_deliver",
        finalizedAt: Date.now(),
      });
      continue;
    }
    notificationsToSend.push(notification);
  }

  return notificationsToSend;
}

export async function markNotificationsInProgress(
  ctx: MutationCtx,
  notifications: Doc<"notifications">[],
) {
  for (const notification of notifications) {
    await ctx.db.patch(notification._id, {
      state: "in_progress",
      errorMessage: undefined,
    });
  }
}

function formatErrorMessage(errorMessage?: string, errorCode?: string) {
  return errorCode
    ? `${errorCode}: ${errorMessage ?? ""}`.trim()
    : errorMessage;
}

export async function scheduleRetry(
  ctx: MutationCtx,
  notificationId: Id<"notifications">,
  options: RuntimeConfig,
  errorMessage?: string,
  errorCode?: string,
) {
  const notification = await ctx.db.get(notificationId);
  if (!notification) {
    return;
  }

  if (
    notification.state === "delivered" ||
    notification.state === "maybe_delivered" ||
    notification.state === "unable_to_deliver"
  ) {
    return;
  }

  const numPreviousFailures = notification.numPreviousFailures + 1;
  const exhausted = numPreviousFailures >= options.retryAttempts;
  const retryDelayMs = Math.min(
    MAX_MESSAGE_RETRY_DELAY_MS,
    options.initialBackoffMs *
      MESSAGE_RETRY_BACKOFF_BASE ** (numPreviousFailures - 1),
  );

  await ctx.db.patch(notificationId, {
    state: exhausted ? "unable_to_deliver" : "needs_retry",
    numPreviousFailures,
    errorMessage: formatErrorMessage(errorMessage, errorCode),
    segment: exhausted
      ? typeof notification.segment === "number"
        ? notification.segment
        : getSegment(Date.now())
      : getFutureSegment(Date.now(), retryDelayMs),
    finalizedAt: exhausted ? Date.now() : FINALIZED_EPOCH,
  });
}

export async function markFailed(
  ctx: MutationCtx,
  notificationId: Id<"notifications">,
  errorMessage?: string,
  errorCode?: string,
) {
  const notification = await ctx.db.get(notificationId);
  if (!notification || notification.state !== "in_progress") {
    return;
  }

  await ctx.db.patch(notificationId, {
    state: "failed",
    errorMessage: formatErrorMessage(errorMessage, errorCode),
    finalizedAt: Date.now(),
  });
}

export async function markDelivered(
  ctx: MutationCtx,
  notificationId: Id<"notifications">,
  expoTicketId?: string,
) {
  const notification = await ctx.db.get(notificationId);
  if (!notification || notification.state !== "in_progress") {
    return;
  }

  await ctx.db.patch(notificationId, {
    state: "delivered",
    expoTicketId,
    errorMessage: undefined,
    finalizedAt: Date.now(),
  });
}

export async function resetCanceledNotification(
  ctx: MutationCtx,
  notificationId: Id<"notifications">,
) {
  const notification = await ctx.db.get(notificationId);
  if (!notification || notification.state !== "in_progress") {
    return;
  }

  await ctx.db.patch(notificationId, {
    state: "awaiting_delivery",
    errorMessage: undefined,
    finalizedAt: FINALIZED_EPOCH,
  });
}

export async function markMaybeDelivered(
  ctx: MutationCtx,
  notificationId: Id<"notifications">,
  errorMessage: string,
) {
  const notification = await ctx.db.get(notificationId);
  if (!notification || notification.state !== "in_progress") {
    return;
  }

  await ctx.db.patch(notificationId, {
    state: "maybe_delivered",
    errorMessage,
    finalizedAt: Date.now(),
  });
}
