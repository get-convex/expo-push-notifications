import { defineSchema, defineTable } from "convex/server";
import { ObjectType, v } from "convex/values";

// https://docs.expo.dev/push-notifications/sending-notifications/#message-request-format

export const notificationFields = {
  _contentAvailable: v.optional(v.boolean()),
  data: v.optional(v.any()),
  title: v.string(),
  subtitle: v.optional(v.string()),
  body: v.optional(v.string()),
  ttl: v.optional(v.number()),
  expiration: v.optional(v.number()),
  priority: v.optional(v.union(v.literal("default"), v.literal("normal"), v.literal("high"))),
  // subtitle: v.optional(v.string()),
  sound: v.optional(v.union(v.string(), v.null())),
  badge: v.optional(v.number()),
  interruptionLevel: v.optional(v.union(v.literal("active"), v.literal("critical"), v.literal("passive"), v.literal("time-sensitive"))),
  channelId: v.optional(v.string()),
  categoryId: v.optional(v.string()),
  mutableContent: v.optional(v.boolean()),
  // sound: v.optional(v.string()),
  // data: v.optional(v.any()),
  categoryIdentifier: v.optional(v.string()),
};

/**
 * Notification fields for push notifications.
 */
export type NotificationFields = {
  /**
   * iOS Only
   * 
   * When this is set to true, the notification will cause the iOS app to start in the background to run a background task.
   * Your app needs to be configured to support this.
   */
  _contentAvailable?: boolean;

  /**
   * Android and iOS
   * 
   * A JSON object delivered to your app. It may be up to about 4KiB;
   * the total notification payload sent to Apple and Google must be at most 4KiB or else you will get a "Message Too Big" error.
   */
  data?: any

  /**
   * Android and iOS
   * 
   * The title to display in the notification. Often displayed above the notification body.
   * Maps to AndroidNotification.title and aps.alert.title.
   */
  title: string;

  /**
   * Android and iOS
   * 
   * The message to display in the notification. Maps to AndroidNotification.body and aps.alert.body.
   */
  body?: string;

  /**
   * Android and iOS
   * 
   * Time to Live: the number of seconds for which the message may be kept around for redelivery
   * if it hasn't been delivered yet. Defaults to undefined to use the respective defaults of each provider
   * (1 month for Android/FCM as well as iOS/APNs).
   */
  ttl?: number;

  /**
   * Android and iOS
   * 
   * Timestamp since the Unix epoch specifying when the message expires.
   * Same effect as ttl (ttl takes precedence over expiration).
   */
  expiration?: number;

  /**
   * Android and iOS
   * 
   * The delivery priority of the message.
   * Specify default or omit this field to use the default priority on each platform ("normal" on Android and "high" on iOS).
   */
  priority?: 'default' | 'normal' | 'high';

  /**
   * iOS Only
   * 
   * The subtitle to display in the notification below the title.
   * Maps to aps.alert.subtitle.
   */
  subtitle?: string;

  /**
   * iOS Only
   * 
   * Play a sound when the recipient receives this notification. Specify default to play the device's default notification sound,
   * or omit this field to play no sound. Custom sounds need to be configured via the config plugin and
   * then specified including the file extension. Example: bells_sound.wav.
   */
  sound?: string | null;

  /**
   * iOS Only
   * 
   * Number to display in the badge on the app icon. Specify zero to clear the badge.
   */
  badge?: number;

  /**
   * iOS Only
   * 
   * The importance and delivery timing of a notification.
   * The string values correspond to the UNNotificationInterruptionLevel enumeration cases.
   */
  interruptionLevel?: 'active' | 'critical' | 'passive' | 'time-sensitive';

  /**
   * Android Only
   * 
   * ID of the Notification Channel through which to display this notification.
   * If an ID is specified but the corresponding channel does not exist on the device (that has not yet been created by your app),
   * the notification will not be displayed to the user.
   */
  channelId?: string;

  /**
   * Android and iOS
   * 
   * ID of the notification category that this notification is associated with.
   */
  categoryId?: string;

  /**
   * iOS Only
   * 
   * Specifies whether this notification can be intercepted by the client app.
   * Defaults to false.
   */
  mutableContent?: boolean;
};

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
