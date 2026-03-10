import { v } from "convex/values";
import { Workpool } from "@convex-dev/workpool";
import type { ComponentApi as WorkpoolComponentApi } from "@convex-dev/workpool/_generated/component.js";
import { components, internal } from "./_generated/api.js";
import type { MutationCtx as RawMutationCtx } from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";
import { internalMutation } from "./functions.js";
import {
  BATCH_SIZE,
  BASE_BATCH_DELAY,
  DEFAULT_RUNTIME_CONFIG,
  getDelayUntilSegment,
  getFutureSegment,
  getSegment,
  type RuntimeConfig,
} from "./shared.js";
import {
  finalizeExhaustedAndReturnDeliverableNotifications,
  getEarliestPendingNotificationSegment,
  getEligibleNotificationsForBatch,
  markDelivered,
  markFailed,
  markMaybeDelivered,
  markNotificationsInProgress,
  resetCanceledNotification,
  scheduleRetry,
} from "./notifs.js";
import type { LogLevel } from "../logging/index.js";
const POOL_MAX_PARALLELISM = 8;

const componentRefs: {
  pushNotificationWorkpool: WorkpoolComponentApi<"pushNotificationWorkpool">;
} = components;

const notificationPool = new Workpool(
  componentRefs.pushNotificationWorkpool,
  {
    maxParallelism: POOL_MAX_PARALLELISM,
  },
);

type SchedulingCtx = RawMutationCtx & {
  logger?: { level: LogLevel };
};

function getLogLevel(ctx: SchedulingCtx): LogLevel {
  return ctx.logger?.level ?? "INFO";
}

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

async function isShuttingDown(ctx: SchedulingCtx) {
  const config = await ctx.db.query("config").unique();
  return config?.state === "shutting_down";
}

async function getEarliestPendingSegment(ctx: SchedulingCtx) {
  return await getEarliestPendingNotificationSegment(ctx, getSegment(Date.now()));
}

async function syncNextBatchRun(
  ctx: SchedulingCtx,
  segment: number | null,
) {
  const existing = await ctx.db.query("nextBatchRun").unique();
  const now = Date.now();
  const currentSegment = getSegment(now);

  if (segment === null) {
    // No queued work remains, so clear the scheduler marker. If the recorded
    // run is still in the future, cancel it; if it is the run currently
    // executing, just drop the row so the state machine no longer thinks a
    // future wake-up exists.
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
    // Keep an already-scheduled future wake-up if it will fire no later than
    // the segment we want. This is the "scheduler is already armed" state.
    if (existing.segment > currentSegment && existing.segment <= segment) {
      return;
    }
    // Otherwise replace the recorded run. Future runs are canceled; stale rows
    // from the currently executing segment are just removed and superseded.
    if (existing.segment > currentSegment) {
      await ctx.scheduler.cancel(existing.runId);
    }
    await ctx.db.delete(existing._id);
  } else if (existing) {
    // Defensive cleanup for older rows that predate the `segment` field.
    await ctx.scheduler.cancel(existing.runId);
    await ctx.db.delete(existing._id);
  }

  // Record the next wake-up that advances the batcher state machine back into
  // `makeBatch` at the chosen eligible segment.
  const runId = await ctx.scheduler.runAfter(
    getDelayUntilSegment(now, segment),
    internal.batch.makeBatch,
    {
      reloop: false,
      segment,
      logLevel: getLogLevel(ctx),
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

  if (await isShuttingDown(ctx)) {
    return;
  }

  const pendingSegment = await getEarliestPendingSegment(ctx);
  const segment =
    pendingSegment === null
      ? null
      : Math.max(pendingSegment, minimumSegment ?? pendingSegment);
  await syncNextBatchRun(ctx, segment);
}

export async function cancelPendingBatches(ctx: RawMutationCtx) {
  await notificationPool.cancelAll(ctx);
}

export const makeBatch = internalMutation({
  args: { reloop: v.boolean(), segment: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const options = await getRuntimeConfig(ctx);
    if (await isShuttingDown(ctx)) {
      return null;
    }

    // Pull the notifications that are eligible for this scheduler segment,
    // prioritizing retries ahead of brand new deliveries.
    const notifications = await getEligibleNotificationsForBatch(
      ctx,
      args.segment,
      BATCH_SIZE,
    );

    // Finalize notifications that have exhausted retries and keep the rest in
    // the candidate batch for this pass.
    const notificationsToSend =
      await finalizeExhaustedAndReturnDeliverableNotifications(
      ctx,
      notifications,
      options.retryAttempts,
    );

    if (notificationsToSend.length === 0) {
      // Nothing is ready to send in this segment, so re-sync the scheduler with
      // whatever queued work remains.
      await scheduleBatchRun(ctx, options);
      return null;
    }

    if (args.reloop && notificationsToSend.length < BATCH_SIZE) {
      // We already dispatched a batch in this cycle. If the immediate follow-up
      // pass only finds a small remainder, defer it by one batching window
      // instead of sending a tiny trailing batch right away.
      await scheduleBatchRun(
        ctx,
        options,
        getFutureSegment(Date.now(), BASE_BATCH_DELAY),
      );
      return null;
    }

    // Reserve these notifications for the outgoing workpool job so no other
    // batch pass tries to pick them up concurrently.
    await markNotificationsInProgress(ctx, notificationsToSend);

    const notificationIds = notificationsToSend.map((n) => n._id);

    // Hand the concrete Expo send to workpool. Request-level retries happen
    // there; per-notification state changes happen later in `onPushComplete`.
    await notificationPool.enqueueAction(
      ctx,
      internal.expo.callExpoPushApiWithBatch,
      { notificationIds, logLevel: ctx.logger.level },
      {
        retry: {
          maxAttempts: options.retryAttempts,
          initialBackoffMs: options.initialBackoffMs,
          base: 2,
        },
        context: { notificationIds },
        onComplete: internal.batch.onPushComplete,
      },
    );

    // Immediately re-enter `makeBatch` so the batcher can keep draining any
    // additional already-eligible work without waiting for another timed wakeup.
    const runId = await ctx.scheduler.runAfter(0, internal.batch.makeBatch, {
      reloop: true,
      segment: args.segment,
      logLevel: ctx.logger.level,
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
          await markDelivered(
            ctx,
            notificationResult.id,
            notificationResult.expoTicketId,
          );
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
