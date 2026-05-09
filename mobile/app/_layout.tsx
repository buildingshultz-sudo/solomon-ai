import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { registerForPushNotifications } from "../src/lib/push";
import { theme } from "../src/lib/theme";

export default function RootLayout() {
  useEffect(() => {
    // Fire and forget; user can deny — the app still works.
    registerForPushNotifications().catch(() => {});
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.bg },
        }}
      />
    </SafeAreaProvider>
  );
}
