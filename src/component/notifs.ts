import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server.js";
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
