import { defineComponent } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import workpool from "@convex-dev/workpool/convex.config";

const component = defineComponent("pushNotifications");
component.use(rateLimiter);
component.use(workpool, { name: "pushNotificationWorkpool" });

export default component;
