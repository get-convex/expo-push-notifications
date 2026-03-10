import { v } from "convex/values";
import { internalMutation } from "./functions.js";
import { FINALIZED_EPOCH } from "./schema.js";

const DEFAULT_LIMIT = 1000;

export const resetLegacyInProgressNotifications = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.object({
    updatedCount: v.number(),
    notificationIds: v.array(v.id("notifications")),
  }),
  handler: async (ctx, args) => {
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("state", (q) => q.eq("state", "in_progress"))
      .take(args.limit ?? DEFAULT_LIMIT);

    const legacyNotifications = notifications.filter(
      (notification) =>
        typeof (notification as { segment?: number }).segment !== "number",
    );

    for (const notification of legacyNotifications) {
      await ctx.db.patch(notification._id, {
        state: "awaiting_delivery",
        finalizedAt: FINALIZED_EPOCH,
      });
    }

    return {
      updatedCount: legacyNotifications.length,
      notificationIds: legacyNotifications.map((notification) => notification._id),
    };
  },
});
