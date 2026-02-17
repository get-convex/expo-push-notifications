import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import type { ExpoPushMessage } from "expo-server-sdk";

// https://docs.expo.dev/push-notifications/sending-notifications/#message-request-format
export const notificationFields = {
  _contentAvailable: v.optional(v.boolean()),
  data: v.optional(v.any()),
  title: v.optional(v.string()),
  body: v.optional(v.string()),
  ttl: v.optional(v.number()),
  expiration: v.optional(v.number()),
  priority: v.optional(
    v.union(v.literal("default"), v.literal("normal"), v.literal("high")),
  ),
  subtitle: v.optional(v.string()),
  sound: v.optional(
    v.union(
      v.string(),
      v.null(),
      v.object({
        critical: v.optional(v.boolean()),
        name: v.optional(v.union(v.string(), v.null())),
        volume: v.optional(v.number()),
      }),
    ),
  ),
  badge: v.optional(v.number()),
  interruptionLevel: v.optional(
    v.union(
      v.literal("active"),
      v.literal("critical"),
      v.literal("passive"),
      v.literal("time-sensitive"),
    ),
  ),
  channelId: v.optional(v.string()),
  icon: v.optional(v.string()),
  richContent: v.optional(v.object({ image: v.optional(v.string()) })),
  categoryId: v.optional(v.string()),
  mutableContent: v.optional(v.boolean()),
};

export type NotificationFields = Omit<ExpoPushMessage, "to">;

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
  v.literal("unable_to_deliver"),
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
