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

## Troubleshooting

To add more logging, provide `PushNotifications` with a `logLevel` in the
constructor:

```ts
const pushNotifications = new PushNotifications(components.pushNotifications, {
  logLevel: "DEBUG",
});
```

If you have an Expo access token, pass it as `expoAccessToken` so requests to
the Expo push API include the `Authorization: Bearer <token>` header:

```ts
const pushNotifications = new PushNotifications(components.pushNotifications, {
  expoAccessToken: process.env.EXPO_ACCESS_TOKEN,
});
```

The push notification sender can be shutdown gracefully, and then restarted
using the `shutdown` and `restart` methods.

<!-- END: Include on https://convex.dev/components -->
