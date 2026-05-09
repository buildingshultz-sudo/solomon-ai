import { Tabs } from "expo-router";
import { Text } from "react-native";
import { theme } from "../../src/lib/theme";

function Icon({ label, focused }: { label: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 18, color: focused ? theme.copper : theme.textMuted }}>{label}</Text>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.bgSoft,
          borderTopColor: theme.border,
          height: 84,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: "700", letterSpacing: 1 },
        tabBarActiveTintColor: theme.copper,
        tabBarInactiveTintColor: theme.textMuted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "CHAT", tabBarIcon: ({ focused }) => <Icon label="◆" focused={focused} /> }}
      />
      <Tabs.Screen
        name="tasks"
        options={{ title: "TASKS", tabBarIcon: ({ focused }) => <Icon label="✓" focused={focused} /> }}
      />
      <Tabs.Screen
        name="memory"
        options={{ title: "MEMORY", tabBarIcon: ({ focused }) => <Icon label="◉" focused={focused} /> }}
      />
      <Tabs.Screen
        name="tools"
        options={{ title: "TOOLS", tabBarIcon: ({ focused }) => <Icon label="⚒" focused={focused} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: "SETUP", tabBarIcon: ({ focused }) => <Icon label="⚙" focused={focused} /> }}
      />
    </Tabs>
  );
}
