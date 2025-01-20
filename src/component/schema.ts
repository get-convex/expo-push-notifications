import { defineSchema, defineTable } from "convex/server";
import { ObjectType, v } from "convex/values";

export const notificationFields = {
  title: v.string(),
  body: v.optional(v.string()),
  sound: v.optional(v.string()),
  data: v.optional(v.any()),
  channelId: v.optional(v.string()),
};

export type NotificationFields = ObjectType<typeof notificationFields>;

export const notificationState = v.union(
  v.literal("awaiting_delivery"),
  v.literal("in_progress"),
  v.literal("delivered"),
  v.literal("needs_retry"),
  // Expo returned a failure for this notification
  v.literal("failed"),
  // Failure before receiving confirmation of delivery, so not safe to retry
  // without delivering twice
  v.literal("maybe_delivered"),
  // Exhausted retries to deliver
  v.literal("unable_to_deliver")
);

export default defineSchema({
  notifications: defineTable({
    token: v.string(),
    metadata: v.object(notificationFields),
    state: notificationState,
    numPreviousFailures: v.number(),
  })
    .index("token", ["token"])
    .index("state", ["state"]),
  pushTokens: defineTable({
    userId: v.string(),
    token: v.string(),
    notificationsPaused: v.optional(v.boolean()),
  }).index("userId", ["userId"]),
  senders: defineTable({
    jobId: v.id("_scheduled_functions"),
    checkJobId: v.id("_scheduled_functions"),
  }),
  senderCoordinator: defineTable({
    jobId: v.id("_scheduled_functions"),
  }),
  config: defineTable({
    state: v.union(v.literal("running"), v.literal("shutting_down")),
  }),
});
