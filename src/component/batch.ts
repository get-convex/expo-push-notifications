import { v } from "convex/values";
import { Workpool } from "@convex-dev/workpool";
import type { ComponentApi as WorkpoolComponentApi } from "@convex-dev/workpool/_generated/component.js";
import {
  ping,
  vBatchQueryArgs,
  vBatchResult,
  vWorkerResult,
} from "@convex-dev/batch-worker";
import { components, internal } from "./_generated/api.js";
import type { MutationCtx as RawMutationCtx } from "./_generated/server.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { internalMutation, internalQuery } from "./functions.js";
import {
  BATCH_SIZE,
  BASE_BATCH_DELAY,
  DEFAULT_RUNTIME_CONFIG,
  getDelayUntilSegment,
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
const WORKER_NAME = "expoPush";

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

/**
 * Make sure the batch-worker loop is running. Call it right after inserting
 * work (and after `onPushComplete` schedules retries). Idempotent — a no-op
 * while the loop is already running or stopped.
 */
export async function pingWorker(ctx: RawMutationCtx) {
  await ping(ctx, components.batchWorker, {
    name: WORKER_NAME,
    workQuery: internal.batch.getBatch,
    workerMutation: internal.batch.processBatch,
    config: { debounceMs: BASE_BATCH_DELAY },
  });
}

export async function cancelPendingBatches(ctx: RawMutationCtx) {
  await notificationPool.cancelAll(ctx);
}

export async function stopWorker(ctx: RawMutationCtx) {
  await ctx.runMutation(components.batchWorker.lib.stop, { name: WORKER_NAME });
}

export async function startWorker(ctx: RawMutationCtx) {
  await ctx.runMutation(components.batchWorker.lib.start, { name: WORKER_NAME });
}

/**
 * Work query: returns the next batch of eligible notifications, or `idle`. When
 * the only pending work is scheduled for a future segment (a retry waiting out
 * its backoff), returns `idle` with a `timeoutMs` so the loop wakes when it's
 * due.
 *
 * Uses vanilla `internalQuery` (not the logLevel-wrapped one) because
 * batch-worker invokes it with only `{ name }`.
 */
export const getBatch = internalQuery({
  args: vBatchQueryArgs,
  returns: vBatchResult(
    v.object({ notificationIds: v.array(v.id("notifications")) }),
  ),
  handler: async (ctx) => {
    const segment = getSegment(Date.now());
    const eligible = await getEligibleNotificationsForBatch(
      ctx,
      segment,
      BATCH_SIZE,
    );
    if (eligible.length > 0) {
      return {
        kind: "work" as const,
        batch: { notificationIds: eligible.map((n) => n._id) },
      };
    }
    const earliest = await getEarliestPendingNotificationSegment(ctx, segment);
    if (earliest !== null) {
      return {
        kind: "idle" as const,
        timeoutMs: getDelayUntilSegment(Date.now(), earliest),
      };
    }
    return { kind: "idle" as const };
  },
});

/**
 * Worker mutation: finalizes exhausted retries, reserves the rest by marking
 * them `in_progress` (which removes them from the eligible set so the next
 * query won't return them again), and hands the concrete Expo send to workpool.
 * Returning nothing re-runs immediately to drain the rest.
 *
 * Uses vanilla `internalMutation` because batch-worker invokes it with only the
 * batch args.
 */
export const processBatch = internalMutation({
  args: { notificationIds: v.array(v.id("notifications")) },
  returns: vWorkerResult,
  handler: async (ctx, args) => {
    const options = await getRuntimeConfig(ctx);
    const docs = await Promise.all(
      args.notificationIds.map((id) => ctx.db.get("notifications", id)),
    );
    const notifications = docs.filter(
      (n): n is Doc<"notifications"> => n !== null,
    );

    const notificationsToSend =
      await finalizeExhaustedAndReturnDeliverableNotifications(
        ctx,
        notifications,
        options.retryAttempts,
      );

    if (notificationsToSend.length === 0) {
      return null;
    }

    // Reserve these notifications so no other batch pass picks them up.
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

    // Wake the loop so it picks up retries scheduled above. If they're in a
    // future segment, `getBatch` returns idle with the right `timeoutMs`.
    await pingWorker(ctx);
  },
});
