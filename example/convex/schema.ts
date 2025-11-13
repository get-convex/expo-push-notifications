import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable(
    v.object({
      name: v.string(),
    }),
  ).index("by_name", ["name"]),
  // Any tables used by the example app go here.
});
