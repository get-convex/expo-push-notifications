import { v } from "convex/values";
import {
  internalQuery,
  type MutationCtx,
} from "./_generated/server.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { FINALIZED_EPOCH } from "./schema.js";
import {
  BASE_BATCH_DELAY,
  MESSAGE_RETRY_BACKOFF_BASE,
  MAX_MESSAGE_RETRY_DELAY_MS,
  getFutureSegment,
  type RuntimeConfig,
} from "./shared.js";

export async function backfillLegacyNotificationFields(
  ctx: MutationCtx,
  batchSize: number,
) {
  const candidates = [
    ...(await ctx.db
      .query("notifications")
      .withIndex("state", (q) => q.eq("state", "awaiting_delivery"))
      .take(batchSize)),
    ...(await ctx.db
      .query("notifications")
      .withIndex("state", (q) => q.eq("state", "needs_retry"))
      .take(batchSize)),
  ];

  for (const notification of candidates) {
    const update: { segment?: number; finalizedAt?: number } = {};
    const maybe = notification as Partial<Doc<"notifications">>;
    if (typeof maybe.segment !== "number") {
      update.segment = getFutureSegment(
        notification._creationTime,
        BASE_BATCH_DELAY,
      );
    }
    if (typeof maybe.finalizedAt !== "number") {
      update.finalizedAt = FINALIZED_EPOCH;
    }
    if (update.segment !== undefined || update.finalizedAt !== undefined) {
      await ctx.db.patch(notification._id, update);
    }
  }
}

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
      ? notification.segment
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
