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
  notifications: defineTable({
    token: v.string(),
    metadata: v.object(notificationFields),
    state: vNotificationStatus,
    numPreviousFailures: v.number(),
    // Kept optional for rollout compatibility with pre-modernization rows.
    // Runtime logic treats missing `segment` as immediately eligible.
    segment: v.optional(v.number()),
    // Reserved for future GC; old rows may legitimately not have it yet.
    finalizedAt: v.optional(v.number()),
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
});

export type NotificationMetadata = NotificationFields;
