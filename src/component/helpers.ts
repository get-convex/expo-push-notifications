import type { MutationCtx } from "./functions.js";
import { cancelPendingBatches, pingWorker, stopWorker } from "./batch.js";

export async function ensureBatchRunScheduled(ctx: MutationCtx) {
  await pingWorker(ctx);
}

export const shutdownGracefully = async (ctx: MutationCtx) => {
  // Halt the batch-worker loop so it stops picking up new work, then cancel any
  // in-flight workpool sends.
  await stopWorker(ctx);
  await cancelPendingBatches(ctx);
  const inProgressNotifications = await ctx.db
    .query("notifications")
    .withIndex("state", (q) => q.eq("state", "in_progress"))
    .take(1000);
  return { inProgressNotifications };
};
