import type { MutationCtx } from "./functions.js";
import type { Doc } from "./_generated/dataModel.js";
import { DEFAULT_RUNTIME_CONFIG } from "./shared.js";
import { cancelPendingBatches, scheduleBatchRun } from "./lib.js";

export async function ensureCoordinator(ctx: MutationCtx) {
  await scheduleBatchRun(ctx, DEFAULT_RUNTIME_CONFIG);
}

export const shutdownGracefully = async (ctx: MutationCtx) => {
  const nextBatchRun = await ctx.db.query("nextBatchRun").unique();
  if (nextBatchRun) {
    await ctx.scheduler.cancel(nextBatchRun.runId);
    await ctx.db.delete(nextBatchRun._id);
  }
  await cancelPendingBatches(ctx);

  const coordinator = await ctx.db.query("senderCoordinator").unique();
  if (coordinator === null) {
    ctx.logger.debug("No coordinator found, no need to restart it");
  } else {
    ctx.logger.info(`Stopping coordinator ${coordinator._id}`);
    await ctx.scheduler.cancel(coordinator.jobId);
    await ctx.db.delete(coordinator._id);
  }
  const senders = await ctx.db.query("senders").collect();
  const inProgressSenders: Array<Doc<"senders">> = [];
  for (const sender of senders) {
    const jobId = sender.jobId;
    const job = await ctx.db.system.get(jobId);
    if (job === null) {
      ctx.logger.error(`Sender ${sender._id} has no job, cleaning up`);
      await ctx.db.delete(sender._id);
      continue;
    }
    switch (job.state.kind) {
      case "pending":
        ctx.logger.info(`Stopping sender ${sender._id}`);
        await ctx.scheduler.cancel(sender.jobId);
        await ctx.db.delete(sender._id);
        break;
      case "inProgress":
        inProgressSenders.push(sender);
        break;
      case "failed":
      case "success":
      case "canceled":
      case null:
        ctx.logger.debug(`Sender ${sender._id} is already done, cleaning up`);
        await ctx.db.delete(sender._id);
        break;
      default: {
        const _typeCheck: never = job.state;
        ctx.logger.error(
          `Unknown job state ${(job.state as any).kind} for sender ${sender._id}. Cleaning it up. `,
        );
        await ctx.db.delete(sender._id);
        break;
      }
    }
  }
  const inProgressNotifications = await ctx.db
    .query("notifications")
    .withIndex("state", (q) => q.eq("state", "in_progress"))
    .take(1000);
  return { inProgressSenders, inProgressNotifications };
};
