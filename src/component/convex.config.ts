import { defineComponent } from "convex/server";
import { v } from "convex/values";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import workpool from "@convex-dev/workpool/convex.config";
import batchWorker from "@convex-dev/batch-worker/convex.config";

const component = defineComponent("pushNotifications", {
  env: {
    EXPO_ACCESS_TOKEN: v.optional(v.string()),
  },
});
component.use(rateLimiter);
component.use(workpool, { name: "pushNotificationWorkpool" });
component.use(batchWorker);

export default component;
