import { v } from "convex/values";
import { Workpool } from "@convex-dev/workpool";
import { RateLimiter } from "@convex-dev/rate-limiter";
import type { ComponentApi as RateLimiterComponentApi } from "@convex-dev/rate-limiter/_generated/component.js";
import type { ComponentApi as WorkpoolComponentApi } from "@convex-dev/workpool/_generated/component.js";
import { components, internal } from "./_generated/api.js";
import {
  internalMutation,
  type MutationCtx,
} from "./_generated/server.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import {
  BATCH_SIZE,
  BASE_BATCH_DELAY,
  DEFAULT_RUNTIME_CONFIG,
  EXPO_ONE_CALL_EVERY_MS,
  getDelayUntilSegment,
  getFutureSegment,
  getSegment,
  type RuntimeConfig,
} from "./shared.js";
import {
  backfillLegacyNotificationFields,
  markFailed,
  markMaybeDelivered,
  resetCanceledNotification,
  scheduleRetry,
} from "./notifs.js";
const POOL_MAX_PARALLELISM = 8;

const componentRefs: {
  pushNotificationWorkpool: WorkpoolComponentApi<"pushNotificationWorkpool">;
  rateLimiter: RateLimiterComponentApi<"rateLimiter">;
} = components;

const notificationPool = new Workpool(
  componentRefs.pushNotificationWorkpool,
  {
    maxParallelism: POOL_MAX_PARALLELISM,
  },
);

const expoApiRateLimiter = new RateLimiter(componentRefs.rateLimiter, {
  expoApi: {
    kind: "fixed window",
    period: EXPO_ONE_CALL_EVERY_MS,
    rate: 1,
  },
});

type SchedulingCtx = {
  db: MutationCtx["db"];
  scheduler: MutationCtx["scheduler"];
};

async function upsertNextBatchRun(
  ctx: SchedulingCtx,
  runId: Id<"_scheduled_functions">,
  segment: number,
) {
  const existing = await ctx.db.query("nextBatchRun").unique();
  if (existing) {
    await ctx.db.patch(existing._id, { runId, segment });
    return;
  }
  await ctx.db.insert("nextBatchRun", { runId, segment });
}

async function getRuntimeConfig(ctx: SchedulingCtx): Promise<RuntimeConfig> {
  const options = await ctx.db.query("lastOptions").unique();
  if (options) {
    return {
      initialBackoffMs: options.initialBackoffMs,
      retryAttempts: options.retryAttempts,
    };
  }
  await ctx.db.insert("lastOptions", DEFAULT_RUNTIME_CONFIG);
  return DEFAULT_RUNTIME_CONFIG;
}

async function upsertRuntimeConfig(ctx: SchedulingCtx, options: RuntimeConfig) {
  const lastOptions = await ctx.db.query("lastOptions").unique();
  if (!lastOptions) {
    await ctx.db.insert("lastOptions", options);
    return;
  }
  if (
    lastOptions.initialBackoffMs !== options.initialBackoffMs ||
    lastOptions.retryAttempts !== options.retryAttempts
  ) {
    await ctx.db.patch(lastOptions._id, options);
  }
}

async function getEarliestPendingSegment(ctx: SchedulingCtx) {
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
    return awaitingNotification!.segment;
  }
  if (!awaitingNotification) {
    return retryNotification.segment;
  }
  return Math.min(retryNotification.segment, awaitingNotification.segment);
}

async function syncNextBatchRun(
  ctx: SchedulingCtx,
  segment: number | null,
) {
  const existing = await ctx.db.query("nextBatchRun").unique();
  const now = Date.now();
  const currentSegment = getSegment(now);

  if (segment === null) {
    if (existing) {
      if (
        typeof existing.segment !== "number" ||
        existing.segment > currentSegment
      ) {
        await ctx.scheduler.cancel(existing.runId);
      }
      await ctx.db.delete(existing._id);
    }
    return;
  }

  if (existing && typeof existing.segment === "number") {
    if (existing.segment <= segment) {
      return;
    }
    if (existing.segment > currentSegment) {
      await ctx.scheduler.cancel(existing.runId);
    }
    await ctx.db.delete(existing._id);
  } else if (existing) {
    await ctx.scheduler.cancel(existing.runId);
    await ctx.db.delete(existing._id);
  }

  const runId = await ctx.scheduler.runAfter(
    getDelayUntilSegment(now, segment),
    internal.batch.makeBatch,
    {
      reloop: false,
      segment,
    },
  );

  await upsertNextBatchRun(ctx, runId, segment);
}

export async function scheduleBatchRun(
  ctx: SchedulingCtx,
  options: RuntimeConfig,
  minimumSegment?: number,
) {
  await upsertRuntimeConfig(ctx, options);

  const config = await ctx.db.query("config").unique();
  if (config?.state === "shutting_down") {
    return;
  }

  const pendingSegment = await getEarliestPendingSegment(ctx);
  const segment =
    pendingSegment === null
      ? null
      : Math.max(pendingSegment, minimumSegment ?? pendingSegment);
  await syncNextBatchRun(ctx, segment);
}

export async function cancelPendingBatches(ctx: MutationCtx) {
  await notificationPool.cancelAll(ctx);
}

async function getDelay(ctx: MutationCtx): Promise<number> {
  const limit = await expoApiRateLimiter.limit(ctx, "expoApi", {
    reserve: true,
  });
  const jitter = Math.random() * 100;
  return limit.retryAfter ? limit.retryAfter + jitter : 0;
}

export const makeBatch = internalMutation({
  args: { reloop: v.boolean(), segment: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await backfillLegacyNotificationFields(ctx, BATCH_SIZE);
    const options = await getRuntimeConfig(ctx);

    const retryNotifications = await ctx.db
      .query("notifications")
      .withIndex("by_state_segment", (q) =>
        q.eq("state", "needs_retry").lte("segment", args.segment),
      )
      .take(BATCH_SIZE);

    const unsentNotifications = await ctx.db
      .query("notifications")
      .withIndex("by_state_segment", (q) =>
        q.eq("state", "awaiting_delivery").lte("segment", args.segment),
      )
      .take(BATCH_SIZE - retryNotifications.length);

    const notifications = [...retryNotifications, ...unsentNotifications];
    const notificationsToSend: Doc<"notifications">[] = [];

    for (const notification of notifications) {
      if (notification.numPreviousFailures >= options.retryAttempts) {
        await ctx.db.patch(notification._id, {
          state: "unable_to_deliver",
          finalizedAt: Date.now(),
        });
      } else {
        notificationsToSend.push(notification);
      }
    }

    if (notificationsToSend.length === 0) {
      await scheduleBatchRun(ctx, options);
      return null;
    }

    if (args.reloop && notificationsToSend.length < BATCH_SIZE) {
      await scheduleBatchRun(
        ctx,
        options,
        getFutureSegment(Date.now(), BASE_BATCH_DELAY),
      );
      return null;
    }

    for (const notification of notificationsToSend) {
      await ctx.db.patch(notification._id, {
        state: "in_progress",
      });
    }

    const delay = await getDelay(ctx);
    const notificationIds = notificationsToSend.map((n) => n._id);

    await notificationPool.enqueueAction(
      ctx,
      internal.expo.callExpoPushApiWithBatch,
      { notificationIds },
      {
        retry: {
          maxAttempts: options.retryAttempts,
          initialBackoffMs: options.initialBackoffMs,
          base: 2,
        },
        runAfter: delay,
        context: { notificationIds },
        onComplete: internal.batch.onPushComplete,
      },
    );

    const runId = await ctx.scheduler.runAfter(0, internal.batch.makeBatch, {
      reloop: true,
      segment: args.segment,
    });
    await upsertNextBatchRun(ctx, runId, args.segment);

    return null;
  },
});

export const onPushComplete = notificationPool.defineOnComplete({
  context: v.object({
    notificationIds: v.array(v.id("notifications")),
  }),
  handler: async (ctx, args) => {
    const options = await getRuntimeConfig(ctx);

    if (args.result.kind === "canceled") {
      for (const id of args.context.notificationIds) {
        await resetCanceledNotification(ctx, id);
      }
    } else if (args.result.kind === "success") {
      const result = args.result.returnValue as
        | {
            kind: "success";
            notifications: Array<{
              id: Id<"notifications">;
              state: "delivered" | "failed" | "needs_retry";
              errorMessage?: string;
              errorCode?: string;
              expoTicketId?: string;
            }>;
          }
        | null;

      if (result === null) {
        return;
      }

      for (const notificationResult of result.notifications) {
        if (notificationResult.state === "delivered") {
          const notification = await ctx.db.get(notificationResult.id);
          if (!notification || notification.state !== "in_progress") {
            continue;
          }
          await ctx.db.patch(notificationResult.id, {
            state: "delivered",
            expoTicketId: notificationResult.expoTicketId,
            finalizedAt: Date.now(),
          });
        } else if (notificationResult.state === "needs_retry") {
          await scheduleRetry(
            ctx,
            notificationResult.id,
            options,
            notificationResult.errorMessage,
            notificationResult.errorCode,
          );
        } else {
          await markFailed(
            ctx,
            notificationResult.id,
            notificationResult.errorMessage,
            notificationResult.errorCode,
          );
        }
      }
    } else if (args.result.kind === "failed") {
      for (const id of args.context.notificationIds) {
        await markMaybeDelivered(ctx, id, args.result.error);
      }
    }

    await scheduleBatchRun(ctx, options);
  },
});
