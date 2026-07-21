import { defineComponent } from "convex/server";
import { v } from "convex/values";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import workpool from "@convex-dev/workpool/convex.config";
import { logLevelValidator } from "../logging/index.js";

const component = defineComponent("pushNotifications", {
  env: {
    EXPO_ACCESS_TOKEN: v.optional(v.string()),
    LOG_LEVEL: v.optional(logLevelValidator),
  },
});
component.use(rateLimiter);
component.use(workpool, { name: "pushNotificationWorkpool" });

export default component;
