import { api } from "@/convex/_generated/api.js";
import { useConvex, useQuery } from "convex/react";
import { useState } from "react";
import { Button, Keyboard, TextInput } from "react-native";
import { ThemedText } from "./themed-text";
import { ThemedView } from "./themed-view";

const FRUIT_EMOJIS = ["🍎", "🍊", "🍇", "🥝", "🍉"];

export function Demo({ expoPushToken }: { expoPushToken: string }) {
  const convex = useConvex();
  const [notifId, setNotifId] = useState<string | null>(null);
  const [name, setName] = useState("User " + Math.floor(Math.random() * 1000));
  const notificationState = useQuery(
    api.example.getNotificationStatus,
    notifId ? { id: notifId } : "skip",
  );
  const allUsers = useQuery(api.example.getUsers) ?? [];

  return (
    <>
      <ThemedText>
        In a real app, you would probably sign in, but for a demo, choose a name
        to associate with your account.
      </ThemedText>
      <TextInput
        placeholder="Enter your name"
        value={name}
        onChangeText={setName}
      />
      <Button
        title="Set up push notifications"
        disabled={!expoPushToken}
        onPress={async () => {
          Keyboard.dismiss();
          if (!expoPushToken) {
            alert("No push token found");
            return;
          }
          await convex
            .mutation(api.example.recordPushNotificationToken, {
              name,
              token: expoPushToken,
            })
            .then(() => {
              alert("Successfully set up push notifications!");
            })
            .catch((error: unknown) => {
              alert(`Error registering for push notifications: ${error}`);
              return undefined;
            });
        }}
      />
      <ThemedText>Send a fruit notification!</ThemedText>
      {allUsers.map((u) => (
        <ThemedView
          key={u._id}
          style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
        >
          <ThemedText>
            {u.name}
            {u.name === name ? " (You)" : ""}
          </ThemedText>
          {FRUIT_EMOJIS.map((emoji, idx) => (
            <Button
              key={idx}
              title={emoji}
              onPress={() => {
                void convex
                  .mutation(api.example.sendPushNotification, {
                    to: u._id,
                    title: `${emoji} from ${name}`,
                  })
                  .then(setNotifId);
              }}
            />
          ))}
        </ThemedView>
      ))}
      {notificationState && (
        <ThemedText>Notification status: {notificationState}</ThemedText>
      )}
    </>
  );
}
