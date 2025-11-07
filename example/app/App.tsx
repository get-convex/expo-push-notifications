import React from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { Demo } from "./Demo";
import { registerRootComponent } from "expo";
import { config as defaultConfig } from "@tamagui/config/v3";
import { createTamagui, TamaguiProvider } from "tamagui";

const config = createTamagui(defaultConfig);

const convex = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL!, {
  unsavedChangesWarning: false,
  verbose: true,
});

export default function RootLayout() {
  return (
    <TamaguiProvider config={config}>
      <ConvexProvider client={convex}>
        <Demo />
      </ConvexProvider>
    </TamaguiProvider>
  );
}

registerRootComponent(RootLayout);
