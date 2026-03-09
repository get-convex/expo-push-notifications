import type { MutationCtx } from "./functions.js";
import { DEFAULT_RUNTIME_CONFIG } from "./shared.js";
import { cancelPendingBatches, scheduleBatchRun } from "./lib.js";

export async function ensureBatchRunScheduled(ctx: MutationCtx) {
  await scheduleBatchRun(ctx, DEFAULT_RUNTIME_CONFIG);
}

export const shutdownGracefully = async (ctx: MutationCtx) => {
  const nextBatchRun = await ctx.db.query("nextBatchRun").unique();
  if (nextBatchRun) {
    await ctx.scheduler.cancel(nextBatchRun.runId);
    await ctx.db.delete(nextBatchRun._id);
  }
  await cancelPendingBatches(ctx);
  const inProgressNotifications = await ctx.db
    .query("notifications")
    .withIndex("state", (q) => q.eq("state", "in_progress"))
    .take(1000);
  return { inProgressNotifications };
};
