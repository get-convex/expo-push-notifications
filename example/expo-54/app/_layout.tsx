import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";

import App from "@/components/App";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ConvexProvider, ConvexReactClient } from "convex/react";

export const unstable_settings = {
  anchor: "(tabs)",
};

const convex = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL!);

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <ConvexProvider client={convex}>
        <App />
        <StatusBar style="auto" />
      </ConvexProvider>
    </ThemeProvider>
  );
}
