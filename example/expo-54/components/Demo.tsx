import { api } from "@/convex/_generated/api.js";
import { useConvex, useQuery } from "convex/react";
import { useState } from "react";
import { Button, Keyboard, Text, TextInput, View } from "react-native";

const FRUIT_EMOJIS = ["🍎", "🍊", "🍇", "🥝", "🍉"];

export function Demo({ expoPushToken }: { expoPushToken: string }) {
  const convex = useConvex();
  const [notifId, setNotifId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const notificationState = useQuery(
    api.example.getNotificationStatus,
    notifId ? { id: notifId } : "skip",
  );
  const allUsers = useQuery(api.example.getUsers) ?? [];

  return (
    <>
      <Text>
        In a real app, you would probably sign in, but for a demo, choose a name
        to associate with your account.
      </Text>
      <TextInput
        placeholder="Enter your name"
        value={name}
        onChangeText={setName}
      />
      <Button
        title="Set up push notifications"
        disabled={expoPushToken === ""}
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
      <Text>Send a fruit notification!</Text>
      {allUsers.map((u) => (
        <View
          key={u._id}
          style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
        >
          <Text>
            {u.name}
            {u.name === name ? " (You)" : ""}
          </Text>
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
        </View>
      ))}
      {notificationState && (
        <Text>Notification status: {notificationState}</Text>
      )}
    </>
  );
}
