import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { api } from "../lib/api";
import { theme } from "../lib/theme";

export default function KillSwitchButton() {
  const [busy, setBusy] = useState(false);
  const onPress = () => {
    Alert.alert(
      "Kill all running tasks?",
      "Aborts every in-flight LLM call, tool, scheduler tick, and import. Cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Kill All",
          style: "destructive",
          onPress: async () => {
            try {
              setBusy(true);
              const r = await api.killAll();
              const n = (r as any)?.killedCount ?? 0;
              Alert.alert("Done", `Terminated ${n} operation${n === 1 ? "" : "s"}.`);
            } catch (e: any) {
              Alert.alert("Kill Switch failed", e?.message ?? String(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => ({
        backgroundColor: pressed ? theme.redHi : theme.red,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 8,
        opacity: busy ? 0.6 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ color: "white", fontWeight: "800", fontSize: 13, letterSpacing: 1 }}>
          ■ KILL ALL
        </Text>
      </View>
    </Pressable>
  );
}
