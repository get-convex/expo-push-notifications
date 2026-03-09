import { v } from "convex/values";
import { Workpool } from "@convex-dev/workpool";
import { RateLimiter } from "@convex-dev/rate-limiter";
import type { ComponentApi as RateLimiterComponentApi } from "@convex-dev/rate-limiter/_generated/component.js";
import type { ComponentApi as WorkpoolComponentApi } from "@convex-dev/workpool/_generated/component.js";
import { components, internal } from "./_generated/api.js";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { DEFAULT_RUNTIME_CONFIG, type RuntimeConfig } from "./shared.js";
import { FINALIZED_EPOCH } from "./schema.js";

const SEGMENT_MS = 125;
const BASE_BATCH_DELAY = 250;
const BATCH_SIZE = 100;
const EXPO_ONE_CALL_EVERY_MS = 200;
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

function getSegment(now: number) {
  return Math.floor(now / SEGMENT_MS);
}

async function upsertNextBatchRun(
  ctx: SchedulingCtx,
  runId: Id<"_scheduled_functions">,
) {
  const existing = await ctx.db.query("nextBatchRun").unique();
  if (existing) {
    await ctx.db.patch(existing._id, { runId });
    return;
  }
  await ctx.db.insert("nextBatchRun", { runId });
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

export async function scheduleBatchRun(
  ctx: SchedulingCtx,
  options: RuntimeConfig,
) {
  await upsertRuntimeConfig(ctx, options);

  const config = await ctx.db.query("config").unique();
  if (config?.state === "shutting_down") {
    return;
  }

  const existing = await ctx.db.query("nextBatchRun").unique();
  if (existing) {
    return;
  }

  const runId = await ctx.scheduler.runAfter(
    BASE_BATCH_DELAY,
    internal.lib.makeBatch,
    {
      reloop: false,
      segment: getSegment(Date.now() + BASE_BATCH_DELAY),
    },
  );

  await upsertNextBatchRun(ctx, runId);
}

export async function cancelPendingBatches(ctx: MutationCtx) {
  await notificationPool.cancelAll(ctx);
}

async function reschedule(ctx: MutationCtx, notificationsLeft: boolean) {
  notificationsLeft =
    notificationsLeft ||
    (await ctx.db
      .query("notifications")
      .withIndex("state", (q) => q.eq("state", "awaiting_delivery"))
      .first()) !== null ||
    (await ctx.db
      .query("notifications")
      .withIndex("state", (q) => q.eq("state", "needs_retry"))
      .first()) !== null;

  if (!notificationsLeft) {
    const batchRun = await ctx.db.query("nextBatchRun").unique();
    if (batchRun) {
      await ctx.db.delete(batchRun._id);
    }
    return;
  }

  const runId = await ctx.scheduler.runAfter(
    BASE_BATCH_DELAY,
    internal.lib.makeBatch,
    {
      reloop: false,
      segment: getSegment(Date.now() + BASE_BATCH_DELAY),
    },
  );
  await upsertNextBatchRun(ctx, runId);
}

async function getDelay(ctx: MutationCtx): Promise<number> {
  const limit = await expoApiRateLimiter.limit(ctx, "expoApi", {
    reserve: true,
  });
  const jitter = Math.random() * 100;
  return limit.retryAfter ? limit.retryAfter + jitter : 0;
}

async function backfillLegacyNotificationFields(ctx: MutationCtx) {
  const candidates = [
    ...(await ctx.db
      .query("notifications")
      .withIndex("state", (q) => q.eq("state", "awaiting_delivery"))
      .take(BATCH_SIZE)),
    ...(await ctx.db
      .query("notifications")
      .withIndex("state", (q) => q.eq("state", "needs_retry"))
      .take(BATCH_SIZE)),
  ];

  for (const notification of candidates) {
    const update: { segment?: number; finalizedAt?: number } = {};
    const maybe = notification as any;
    if (typeof maybe.segment !== "number") {
      update.segment = getSegment(notification._creationTime);
    }
    if (typeof maybe.finalizedAt !== "number") {
      update.finalizedAt = FINALIZED_EPOCH;
    }
    if (update.segment !== undefined || update.finalizedAt !== undefined) {
      await ctx.db.patch(notification._id, update);
    }
  }
}

export const makeBatch = internalMutation({
  args: { reloop: v.boolean(), segment: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await backfillLegacyNotificationFields(ctx);
    const options = await getRuntimeConfig(ctx);

    const retryNotifications = await ctx.db
      .query("notifications")
      .withIndex("by_state_segment", (q) =>
        q.eq("state", "needs_retry").lte("segment", args.segment - 2),
      )
      .take(BATCH_SIZE);

    const unsentNotifications = await ctx.db
      .query("notifications")
      .withIndex("by_state_segment", (q) =>
        q.eq("state", "awaiting_delivery").lte("segment", args.segment - 2),
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

    if (
      notificationsToSend.length === 0 ||
      (args.reloop && notificationsToSend.length < BATCH_SIZE)
    ) {
      await reschedule(ctx, notificationsToSend.length > 0);
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
      internal.lib.callExpoPushApiWithBatch,
      { notificationIds },
      {
        retry: {
          maxAttempts: 1,
          initialBackoffMs: options.initialBackoffMs,
          base: 2,
        },
        runAfter: delay,
        context: { notificationIds },
        onComplete: internal.lib.onPushComplete,
      },
    );

    const runId = await ctx.scheduler.runAfter(0, internal.lib.makeBatch, {
      reloop: true,
      segment: args.segment,
    });
    await upsertNextBatchRun(ctx, runId);

    return null;
  },
});

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

const vSendResult = v.union(
  v.null(),
  v.object({
    kind: v.literal("success"),
    notifications: v.array(
      v.object({
        id: v.id("notifications"),
        state: v.union(v.literal("delivered"), v.literal("failed")),
        errorMessage: v.optional(v.string()),
        expoTicketId: v.optional(v.string()),
      }),
    ),
  }),
  v.object({
    kind: v.literal("maybe_delivered"),
    notificationIds: v.array(v.id("notifications")),
    errorMessage: v.string(),
  }),
);

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
    }> = await ctx.runQuery(internal.lib.getNotificationsByIds, {
      notificationIds: args.notificationIds,
    });

    const inProgress = notifications.filter(
      (n: { state: string }) => n.state === "in_progress",
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
      return {
        kind: "maybe_delivered",
        notificationIds: inProgress.map((n) => n._id),
        errorMessage: `Expo API error: ${response.status} ${response.statusText} ${await response.text()}`,
      } as const;
    }

    const responseBody: {
      data: Array<
        { status: "ok"; id: string } | { status: "error"; message?: string }
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
          state: "failed" as const,
          errorMessage: item?.message ?? "Unknown Expo error",
        };
      }),
    } as const;
  },
});

async function markForRetry(
  ctx: MutationCtx,
  notificationId: Id<"notifications">,
  errorMessage?: string,
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

  const options = await getRuntimeConfig(ctx);
  const numPreviousFailures = notification.numPreviousFailures + 1;
  const exhausted = numPreviousFailures >= options.retryAttempts;

  await ctx.db.patch(notificationId, {
    state: exhausted ? "unable_to_deliver" : "needs_retry",
    numPreviousFailures,
    errorMessage,
    finalizedAt: exhausted ? Date.now() : FINALIZED_EPOCH,
  });
}

async function resetCanceledNotification(
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

export const onPushComplete = notificationPool.defineOnComplete({
  context: v.object({
    notificationIds: v.array(v.id("notifications")),
  }),
  handler: async (ctx, args) => {
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
              state: "delivered" | "failed";
              errorMessage?: string;
              expoTicketId?: string;
            }>;
          }
        | {
            kind: "maybe_delivered";
            notificationIds: Id<"notifications">[];
            errorMessage: string;
          }
        | null;

      if (result === null) {
        return;
      }

      if (result.kind === "maybe_delivered") {
        for (const id of result.notificationIds) {
          const notification = await ctx.db.get(id);
          if (!notification || notification.state !== "in_progress") {
            continue;
          }
          await ctx.db.patch(id, {
            state: "maybe_delivered",
            errorMessage: result.errorMessage,
            finalizedAt: Date.now(),
          });
        }
      } else {
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
          } else {
            await markForRetry(
              ctx,
              notificationResult.id,
              notificationResult.errorMessage,
            );
          }
        }
      }
    } else if (args.result.kind === "failed") {
      for (const id of args.context.notificationIds) {
        await markForRetry(ctx, id, args.result.error);
      }
    }

    const options = await getRuntimeConfig(ctx);
    await scheduleBatchRun(ctx, options);
  },
});
