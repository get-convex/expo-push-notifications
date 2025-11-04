import type { MutationCtx } from "./functions.js";
import { internal } from "./_generated/api.js";
import type { Doc } from "./_generated/dataModel.js";

export async function ensureCoordinator(ctx: MutationCtx) {
  ctx.logger.debug("Ensuring there's a notification coordinator");
  const coordinators = await ctx.db.query("senderCoordinator").collect();
  const activeCoordinators: Array<Doc<"senderCoordinator">> = [];
  for (const coordinator of coordinators) {
    const job = await ctx.db.system.get(coordinator.jobId);
    if (
      job === null ||
      !(job.state.kind === "pending" || job.state.kind === "inProgress")
    ) {
      await ctx.db.delete(coordinator._id);
    } else {
      activeCoordinators.push(coordinator);
    }
  }
  if (activeCoordinators.length === 1) {
    ctx.logger.debug(
      `Found existing coordinator with ID ${activeCoordinators[0]._id}`,
    );
    return;
  }
  if (activeCoordinators.length > 1) {
    ctx.logger.error(
      `Unexpected state: Too many coordinators ${activeCoordinators.length}`,
    );
    throw new Error(
      `Unexpected state: Too many coordinators ${activeCoordinators.length}`,
    );
  }
  const config = await ctx.db.query("config").unique();
  if (config?.state === "shutting_down") {
    ctx.logger.info("Shutting down, so not starting a new coordinator.");
    return;
  }
  const coordinatorJobId = await ctx.scheduler.runAfter(
    250,
    internal.internal.coordinateSendingPushNotifications,
    {
      logLevel: ctx.logger.level,
    },
  );
  const coordinatorId = await ctx.db.insert("senderCoordinator", {
    jobId: coordinatorJobId,
  });
  ctx.logger.debug(`Started a new coordinator ${coordinatorId}`);
}

export const shutdownGracefully = async (ctx: MutationCtx) => {
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          `Unknown job state ${(job.state as any).kind} for sender ${sender._id}. Cleaning it up. `,
        );
        await ctx.db.delete(sender._id);
        break;
      }
    }
  }
  return { inProgressSenders };
};
