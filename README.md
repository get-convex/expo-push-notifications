# Convex Push Notifications Component

[![npm version](https://badge.fury.io/js/@convex-dev%2Fexpo-push-notifications.svg)](https://badge.fury.io/js/@convex-dev%2Fexpo-push-notifications)

<!-- START: Include on https://convex.dev/components -->

This is a Convex component that integrates with
[Expo's push notification API](https://docs.expo.dev/push-notifications/overview/)
to allow sending mobile push notifications to users of your app. It will batch
calls to Expo's API and handle retrying delivery.

<details>
  <summary>Demo GIF</summary>

![Demo of sending push notifications](./output.gif)

</details>

<details>
<summary>Example usage:</summary>

```tsx
// App.tsx
<Button
  onPress={() => {
    void convex.mutation(api.example.sendPushNotification, {
      to: otherUser,
      title: `Hi from ${currentUser.name}`,
    });
  }}
>
  <Text>Say hi!</Text>
</Button>
```

```typescript
// convex/example.ts
export const sendPushNotification = mutation({
  args: { title: v.string(), to: v.id("users") },
  handler: async (ctx, args) => {
    // Sending a notification
    return pushNotifications.sendPushNotification(ctx, {
      userId: args.to,
      notification: {
        title: args.title,
      },
    });
  },
});
```

</details>

## Pre-requisite: Convex

You'll need an existing Convex project to use the component. Convex is a hosted
backend platform, including a database, serverless functions, and a ton more you
can learn about [here](https://docs.convex.dev/get-started).

Run `npm create convex` or follow any of the
[quickstarts](https://docs.convex.dev/home) to set one up.

## Installation

Install the component package:

```
npm i @convex-dev/expo-push-notifications
```

Create a `convex.config.ts` file in your app's `convex/` folder and install the
component by calling `use`:

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import pushNotifications from "@convex-dev/expo-push-notifications/convex.config.js";

const app = defineApp();
app.use(pushNotifications);
// other components

export default app;
```

Instantiate the `PushNotifications` client in your Convex functions:

```ts
// convex/example.ts
import { PushNotifications } from "@convex-dev/expo-push-notifications";

const pushNotifications = new PushNotifications(components.pushNotifications);
```

It takes in an optional type parameter (defaulting to `Id<"users">`) for the
type to use as a unique identifier for push notification recipients:

```ts
import { PushNotifications } from "@convex-dev/expo-push-notifications";

export type Email = string & { __isEmail: true };

const pushNotifications = new PushNotifications<Email>(
  components.pushNotifications,
);
```

## Registering a user for push notifications

Get a user's push notification token following the Expo documentation
[here](https://docs.expo.dev/push-notifications/push-notifications-setup/#registering-for-push-notifications),
and record it using a Convex mutation:

```ts
// convex/example.ts
export const recordPushNotificationToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    await pushNotifications.recordToken(ctx, {
      userId,
      pushToken: args.token,
    });
  },
});
```

You can pause and resume push notification sending for a user using the
`pausePushNotifications` and `resumePushNotifications` methods.

To determine if a user has a token and their pause status, you can use
`getStatusForUser`.

## Send notifications

```ts
// convex/example.ts
export const sendPushNotification = mutation({
  args: { title: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    const pushId = await pushNotifications.sendPushNotification(ctx, {
      userId: args.to,
      notification: {
        title: args.title,
      },
    });
  },
});
```

You can use the ID returned from `sendPushNotifications` to query the status of
the notification using `getNotification`. Using this in a query allows you to
subscribe to the status of a notification.

You can also view all notifications for a user with `getNotificationsForUser`.

## How delivery works

1. **How individual notifications are inserted**

   `sendPushNotification` and `sendPushNotificationBatch` first look up the
   user's Expo token. If the user has no token, the component either throws or
   returns `null` depending on `allowUnregisteredTokens`. If the user's token is
   paused, the notification is dropped and `null` is returned. Otherwise the
   component inserts a row into the `notifications` table with
   `state = "awaiting_delivery"`, a failure count of `0`, and a short
   time-bucket marker used for batching.

2. **How the batcher stays alive while work remains**

   Every successful insert calls an internal helper that ensures exactly one
   future batch run is scheduled for the earliest eligible notification
   segment. If a newly inserted notification becomes eligible sooner than the
   currently scheduled run, the component cancels the later wake-up and
   reschedules it earlier. When that batch run wakes up, it either:
   finds work and enqueues one or more workpool jobs, or finds no work and
   clears the pending batch-run marker. After each workpool job completes, the
   component schedules the next batch pass again if there is still work left.

3. **How workpool threads parallelize the work**

   Each batch becomes one workpool job. The workpool limits how many of those
   jobs may run at once via `maxParallelism`, and it keeps its own pending and
   running bookkeeping internally. Before a batch is handed to the workpool, the
   notifications in that batch are marked `in_progress`, which prevents the
   component from selecting the same notification for another batch at the same
   time.

4. **How partial failures are reflected**

   Expo can accept some notifications in a batch and reject others in the same
   response. The component records that result per notification: delivered
   notifications are finalized as `delivered`, non-retryable ticket failures are
   finalized as `failed`, and documented temporary ticket failures such as
   `MessageRateExceeded` are moved to `needs_retry`. Failed notifications are
   not retried inline in the same HTTP request; they are picked up by a later
   batch pass. Request-level failures are handled separately by the workpool
   retry policy.

5. **How temporary failures are deferred**

   There are two retry layers. If the whole Expo request fails, the workpool
   retries that batch with exponential backoff. If Expo returns a successful
   batch response with some individual temporary message failures, those
   notifications are deferred by moving them back into the queue as
   `needs_retry` and advancing their next eligible segment using exponential
   backoff. The next batch pass prioritizes `needs_retry` notifications over
   brand new ones once their scheduled segment becomes eligible, and it sleeps
   until that exact segment instead of polling.

6. **How shutdown and paused tokens interact**

   Paused tokens short-circuit before insertion, so paused users do not create
   queued notifications. `shutdown()` cancels future batch scheduling and
   cancels pending workpool jobs that have not started yet. Batches already
   marked `in_progress` are allowed to drain, and `restart()` resumes scheduling
   once those in-flight notifications have finished.

## Troubleshooting

To add more logging, provide `PushNotifications` with a `logLevel` in the
constructor:

```ts
const pushNotifications = new PushNotifications(components.pushNotifications, {
  logLevel: "DEBUG",
});
```

The push notification sender can be shutdown gracefully, and then restarted
using the `shutdown` and `restart` methods.

<!-- END: Include on https://convex.dev/components -->
