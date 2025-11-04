import { ConvexError, v, type Infer } from "convex/values";
import { mutation, query, type MutationCtx } from "./functions.js";
import { notificationFields, notificationState } from "./schema.js";
import { ensureCoordinator, shutdownGracefully } from "./helpers.js";
import { api } from "./_generated/api.js";

const DEFAULT_LIMIT = 1000;

export const recordPushNotificationToken = mutation({
  args: {
    userId: v.string(),
    pushToken: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { userId, pushToken }) => {
    if (pushToken === "") {
      ctx.logger.debug("Push token is empty, skipping");
      return;
    }
    const existingToken = await ctx.db
      .query("pushTokens")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .unique();
    if (existingToken !== null) {
      ctx.logger.debug(
        `Push token already exists for user ${userId}, updating token`,
      );
      await ctx.db.patch(existingToken._id, { token: pushToken });
      return;
    }
    await ctx.db.insert("pushTokens", { userId, token: pushToken });
  },
});

export const removePushNotificationToken = mutation({
  args: {
    userId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const existingToken = await ctx.db
      .query("pushTokens")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .unique();
    if (existingToken === null) {
      ctx.logger.debug(`No push token found for user ${userId}, doing nothing`);
      return;
    }
    await ctx.db.delete(existingToken._id);
  },
});

const sendPushNotificationArgs = v.object({
  userId: v.string(),
  notification: v.object(notificationFields),
  allowUnregisteredTokens: v.optional(v.boolean()),
});

export const sendPushNotification = mutation({
  args: sendPushNotificationArgs,
  returns: v.union(v.id("notifications"), v.null()),
  handler: async (ctx, args) => {
    const result = await sendPushNotificationHandler(ctx, args);
    await ensureCoordinator(ctx);
    return result;
  },
});

export const sendPushNotificationBatch = mutation({
  args: {
    notifications: v.array(
      v.object({
        userId: v.string(),
        notification: v.object(notificationFields),
      }),
    ),
    allowUnregisteredTokens: v.optional(v.boolean()),
  },
  returns: v.array(v.union(v.id("notifications"), v.null())),
  handler: async (ctx, args) => {
    const results = [];
    for (const { userId, notification } of args.notifications) {
      const result = await sendPushNotificationHandler(ctx, {
        userId,
        notification,
        allowUnregisteredTokens: args.allowUnregisteredTokens,
      });
      results.push(result);
    }
    await ensureCoordinator(ctx);
    return results;
  },
});

async function sendPushNotificationHandler(
  ctx: MutationCtx,
  args: Infer<typeof sendPushNotificationArgs>,
) {
  const token = await ctx.db
    .query("pushTokens")
    .withIndex("userId", (q) => q.eq("userId", args.userId))
    .unique();
  if (token === null) {
    ctx.logger.error(
      `No push token found for user ${args.userId}, cannot send notification`,
    );
    if (args.allowUnregisteredTokens) {
      return null;
    }
    throw new ConvexError({
      code: "NoPushToken",
      message: "No push token found for user",
      userId: args.userId,
      notification: args.notification,
    });
  }
  if (token.notificationsPaused) {
    ctx.logger.info(
      `Notifications are paused for user ${args.userId}, skipping`,
    );
    return null;
  }
  const id = await ctx.db.insert("notifications", {
    token: token.token,
    metadata: args.notification,
    state: "awaiting_delivery",
    numPreviousFailures: 0,
  });
  ctx.logger.debug(`Recording notification for user ${args.userId}`);
  return id;
}

export const getNotification = query({
  args: { id: v.id("notifications") },
  returns: v.union(
    v.null(),
    v.object({
      ...notificationFields,
      state: notificationState,
      numPreviousFailures: v.number(),
      _creationTime: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const notification = await ctx.db.get(args.id);
    if (!notification) {
      return null;
    }
    const { metadata, numPreviousFailures, state, _creationTime } =
      notification;
    return { ...metadata, numPreviousFailures, state, _creationTime };
  },
});

export const getNotificationsForUser = query({
  args: { userId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      ...notificationFields,
      id: v.id("notifications"),
      state: notificationState,
      numPreviousFailures: v.number(),
      _creationTime: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const token = await ctx.db
      .query("pushTokens")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (token === null) {
      return [];
    }
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("token", (q) => q.eq("token", token.token))
      .order("desc")
      .take(args.limit ?? DEFAULT_LIMIT);
    return notifications.map(
      ({ _id, metadata, state, numPreviousFailures, _creationTime }) => ({
        id: _id,
        ...metadata,
        state: state,
        numPreviousFailures: numPreviousFailures,
        _creationTime,
      }),
    );
  },
});

export const deleteNotificationsForUser = mutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const token = await ctx.db
      .query("pushTokens")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (token === null) {
      ctx.logger.info("No push token found for user, nothing to delete");
      return;
    }
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("token", (q) => q.eq("token", token.token))
      .take(DEFAULT_LIMIT);
    for (const notification of notifications) {
      await ctx.db.delete(notification._id);
    }
    if (notifications.length > 0) {
      ctx.logger.info(
        `Deleted ${notifications.length} notifications for user ${args.userId}`,
      );
    }
    if (notifications.length === DEFAULT_LIMIT) {
      ctx.logger.info(
        `Reached limit of ${DEFAULT_LIMIT} notifications for user ${args.userId},` +
          ` scheduling another deletion`,
      );
      await ctx.scheduler.runAfter(0, api.public.deleteNotificationsForUser, {
        ...args,
        logLevel: ctx.logger.level,
      });
    }
  },
});

// e.g. pause sending notifications while the user is active in the app
export const pauseNotificationsForUser = mutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const existingToken = await ctx.db
      .query("pushTokens")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .unique();
    if (existingToken === null) {
      ctx.logger.debug(`No push token found for user ${userId}, doing nothing`);
      return;
    }
    ctx.logger.info(`Pausing notifications for user ${userId}`);
    await ctx.db.patch(existingToken._id, {
      notificationsPaused: true,
    });
  },
});

export const unpauseNotificationsForUser = mutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const existingToken = await ctx.db
      .query("pushTokens")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .unique();
    if (existingToken === null) {
      ctx.logger.debug(`No push token found for user ${userId}, doing nothing`);
      return;
    }
    ctx.logger.info(`Unpausing notifications for user ${userId}`);
    await ctx.db.patch(existingToken._id, {
      notificationsPaused: false,
    });
  },
});

export const getStatusForUser = query({
  args: { userId: v.string() },
  returns: v.object({ hasToken: v.boolean(), paused: v.boolean() }),
  handler: async (ctx, { userId }) => {
    const existingToken = await ctx.db
      .query("pushTokens")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .unique();
    if (existingToken === null) {
      ctx.logger.debug(
        `No push token found for user ${userId}, returning false`,
      );
      return { hasToken: false, paused: false };
    }
    return {
      hasToken: true,
      paused: existingToken.notificationsPaused ?? false,
    };
  },
});

export const shutdown = mutation({
  args: {},
  returns: v.object({
    message: v.string(),
    data: v.optional(v.any()),
  }),
  handler: async (ctx) => {
    const { inProgressSenders } = await shutdownGracefully(ctx);
    if (inProgressSenders.length === 0) {
      return { message: "success" };
    }
    const config = await ctx.db.query("config").unique();
    if (config === null) {
      ctx.logger.debug("No config found, creating it");
      await ctx.db.insert("config", {
        state: "shutting_down",
      });
    } else {
      await ctx.db.patch(config._id, {
        state: "shutting_down",
      });
    }
    return {
      message: `There are ${inProgressSenders.length} jobs currently sending notifications that will continue running. Wait a few seconds for them to finish and then restart the service.`,
      data: {
        inProgressSenderIds: inProgressSenders.map((sender) => sender._id),
      },
    };
  },
});

export const restart = mutation({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const { inProgressSenders } = await shutdownGracefully(ctx);
    if (inProgressSenders.length > 0) {
      ctx.logger.error(
        `There are ${inProgressSenders.length} jobs currently sending notifications. Wait a few seconds for them to finish and try to restart again.`,
      );
      return false;
    }
    const config = await ctx.db.query("config").unique();
    if (config !== null) {
      await ctx.db.patch(config._id, {
        state: "running",
      });
    } else {
      await ctx.db.insert("config", {
        state: "running",
      });
    }
    await ensureCoordinator(ctx);
    return true;
  },
});
