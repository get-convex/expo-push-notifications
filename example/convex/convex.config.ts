import { defineApp } from "convex/server";
import pushNotifications from "@convex-dev/expo-push-notifications/convex.config.js";
import { v } from "convex/values";

const app = defineApp({
  env: {
    EXPO_ACCESS_TOKEN: v.optional(v.string()),
  },
});

app.use(pushNotifications, {
  env: {
    EXPO_ACCESS_TOKEN: app.env.EXPO_ACCESS_TOKEN,
  }
});

export default app;
