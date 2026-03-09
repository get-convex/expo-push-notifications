import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  notificationFields,
  type NotificationFields,
  vNotificationStatus,
} from "./shared.js";

export { notificationFields } from "./shared.js";
export type { NotificationFields } from "./shared.js";
export const notificationState = vNotificationStatus;

export const FINALIZED_EPOCH = Number.MAX_SAFE_INTEGER;

export default defineSchema({
  nextBatchRun: defineTable({
    runId: v.id("_scheduled_functions"),
  }),
  lastOptions: defineTable({
    initialBackoffMs: v.number(),
    retryAttempts: v.number(),
  }),
  notifications: defineTable({
    token: v.string(),
    metadata: v.object(notificationFields),
    state: vNotificationStatus,
    numPreviousFailures: v.number(),
    segment: v.number(),
    finalizedAt: v.number(),
    expoTicketId: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  })
    .index("token", ["token"])
    .index("state", ["state"])
    .index("by_state_segment", ["state", "segment"])
    .index("by_finalizedAt", ["finalizedAt"]),
  pushTokens: defineTable({
    userId: v.string(),
    token: v.string(),
    notificationsPaused: v.optional(v.boolean()),
  }).index("userId", ["userId"]),
  config: defineTable({
    state: v.union(v.literal("running"), v.literal("shutting_down")),
  }),
});

export type NotificationMetadata = NotificationFields;
