import {
  Expand,
  FunctionReference,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
} from "convex/server";
import { GenericId } from "convex/values";
import { api } from "../component/_generated/api.js";
import { NotificationFields } from "../component/schema.js";
import { LogLevel } from "../logging/index.js";

/**
 * This component uses Expo's push notification API
 * (https://docs.expo.dev/push-notifications/overview/)
 * to allow users to send each other push notifications.
 *
 * This component takes in a type parameter `UserType` that should
 * correspond to the unique identifier you want to use when sending
 * notifications in your app (e.g. `Id<"users">` or a branded string
 * `type Email = string & { __isEmail: true }`).
 */
export class PushNotifications<UserType extends string = GenericId<"users">> {
  private config: {
    logLevel: LogLevel;
  };
  constructor(
    public component: UseApi<typeof api>,
    config?: {
      logLevel?: LogLevel;
    }
  ) {
    this.component = component;
    this.config = {
      ...(config ?? {}),
      logLevel: config?.logLevel ?? "ERROR",
    };
  }

  /**
   * Takes in an Expo Push Token fetched from the client (https://docs.expo.dev/versions/latest/sdk/notifications/#expopushtoken).
   *
   * This allows sending notifications for this user using this token.
   */
  recordToken(
    ctx: RunMutationCtx,
    args: { userId: UserType; pushToken: string }
  ): Promise<null> {
    return ctx.runMutation(this.component.public.recordPushNotificationToken, {
      ...args,
      logLevel: this.config.logLevel,
    });
  }

  /**
   * This removes the push notification token for a user if it exists.
   *
   * Once this is run, notifications can no longer be sent to this user.
   */
  removeToken(ctx: RunMutationCtx, args: { userId: UserType }): Promise<null> {
    return ctx.runMutation(this.component.public.removePushNotificationToken, {
      ...args,
      logLevel: this.config.logLevel,
    });
  }

  /**
   * Gets the status of a user: whether they have a token and whether notifications are paused.
   */
  getStatusForUser(ctx: RunQueryCtx, args: { userId: UserType }) {
    return ctx.runQuery(this.component.public.getStatusForUser, {
      ...args,
      logLevel: this.config.logLevel,
    });
  }

  /**
   * Sends a push notification to the user with the given token.
   *
   * If allowUnregisteredTokens is true, we will log when there is no token for
   * a user and not attempt to send a notification.
   *
   * If allowUnregisteredTokens is false, we will throw a ConvexError if there is no
   * token for a user.
   *
   * Notification delivery will be batched for efficient delivery.
   * @returns The ID of the notification, to be used to query the status.
   * Or null if the user has paused notifications.
   * @throws ConvexError if the user has no token and allowUnregisteredTokens is false.
   */
  sendPushNotification(
    ctx: RunMutationCtx,
    args: {
      userId: UserType;
      notification: NotificationFields;
      allowUnregisteredTokens?: boolean;
    }
  ) {
    return ctx.runMutation(this.component.public.sendPushNotification, {
      ...args,
      logLevel: this.config.logLevel,
    });
  }

  /**
   * Sends push notifications to multiple users in batch.
   *
   * @param ctx The mutation context
   * @param args Object containing list of {userId, notification} pairs and allowUnregisteredTokens flag
   * @returns Promise resolving when all notifications are processed
   */
  sendPushNotificationBatch(
    ctx: RunMutationCtx,
    args: {
      notifications: Array<{
        userId: UserType;
        notification: NotificationFields;
      }>;
      allowUnregisteredTokens?: boolean;
    }
  ) {
    return ctx.runMutation(this.component.public.sendPushNotificationBatch, {
      ...args,
      logLevel: this.config.logLevel,
    });
  }

  /**
   * Gets the notification by ID returned from {@link sendPushNotification}.
   * Returns null if there is no record of a notification with that ID.
   */
  getNotification(ctx: RunQueryCtx, args: { id: string }) {
    return ctx.runQuery(this.component.public.getNotification, {
      ...args,
      logLevel: this.config.logLevel,
    });
  }

  /**
   * Gets the most recent notifications for a user, up to `limit` (default 1000)
   */
  getNotificationsForUser(
    ctx: RunQueryCtx,
    args: { userId: UserType; limit?: number }
  ) {
    return ctx.runQuery(this.component.public.getNotificationsForUser, {
      ...args,
      logLevel: this.config.logLevel,
    });
  }

  /**
   * Deletes all notifications for a user.
   */
  deleteNotificationsForUser(ctx: RunMutationCtx, args: { userId: UserType }) {
    return ctx.runMutation(this.component.public.deleteNotificationsForUser, {
      ...args,
      logLevel: this.config.logLevel,
    });
  }

  /**
   * Temporarily pause notifications for a user, for instance when the user is
   * actively using the app, or able to see notifications elsewhere.
   *
   * Notifications sent while paused will be dropped and will not be retried.
   */
  pauseNotificationsForUser(ctx: RunMutationCtx, args: { userId: UserType }) {
    return ctx.runMutation(this.component.public.pauseNotificationsForUser, {
      ...args,
      logLevel: this.config.logLevel,
    });
  }

  /**
   * Resume notifications for a user.
   * @param ctx
   * @param args
   * @returns
   */
  unpauseNotificationsForUser(ctx: RunMutationCtx, args: { userId: UserType }) {
    return ctx.runMutation(this.component.public.unpauseNotificationsForUser, {
      ...args,
      logLevel: this.config.logLevel,
    });
  }

  /**
   * Gracefully shut down the push notification sender.
   *
   * If notifications aren't being sent for some reason, this will attempt to gracefully
   * cancel any running jobs. To restart the push notification sender, call restart().
   *
   * @param ctx
   * @returns
   */
  shutdown(ctx: RunMutationCtx) {
    return ctx.runMutation(this.component.public.shutdown, {
      logLevel: this.config.logLevel,
    });
  }

  /**
   * Restart the push notification sender.
   *
   * Call `shutdown()` first to gracefully drain any jobs in progress.
   * @param ctx
   * @returns {boolean} true if the restart was successful, false if it was not (i.e. if there are still jobs in progress)
   */
  restart(ctx: RunMutationCtx): Promise<boolean> {
    return ctx.runMutation(this.component.public.restart, {
      logLevel: this.config.logLevel,
    });
  }
}

/* Type utils follow */

type RunQueryCtx = {
  runQuery: GenericQueryCtx<GenericDataModel>["runQuery"];
};
type RunMutationCtx = {
  runMutation: GenericMutationCtx<GenericDataModel>["runMutation"];
};

export type OpaqueIds<T> =
  T extends GenericId<infer _T>
    ? string
    : T extends (infer U)[]
      ? OpaqueIds<U>[]
      : T extends object
        ? { [K in keyof T]: OpaqueIds<T[K]> }
        : T;

export type UseApi<API> = Expand<{
  [mod in keyof API]: API[mod] extends FunctionReference<
    infer FType,
    "public",
    infer FArgs,
    infer FReturnType,
    infer FComponentPath
  >
    ? FunctionReference<
        FType,
        "internal",
        OpaqueIds<FArgs>,
        OpaqueIds<FReturnType>,
        FComponentPath
      >
    : UseApi<API[mod]>;
}>;
