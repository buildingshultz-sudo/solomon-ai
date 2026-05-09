import { useEffect, useState, useCallback } from "react";
import { FlatList, RefreshControl, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Header from "../../src/components/Header";
import { api } from "../../src/lib/api";
import { theme } from "../../src/lib/theme";

export default function ToolsScreen() {
  const [runs, setRuns] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r: any = await api.toolRunsRecent();
      setRuns(Array.isArray(r) ? r : []);
    } catch {
      setRuns([]);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={["top"]}>
      <Header title="Tool runs" />
      <FlatList
        data={runs}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={theme.copper} />}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        ListEmptyComponent={
          <Text style={{ color: theme.textMuted, textAlign: "center", marginTop: 24 }}>
            No tool runs yet.
          </Text>
        }
        renderItem={({ item }) => {
          const colorByStatus =
            item.status === "success" ? theme.green : item.status === "error" ? theme.red : theme.copper;
          return (
            <View
              style={{
                backgroundColor: theme.card,
                borderRadius: 10,
                padding: 12,
                borderWidth: 1,
                borderColor: theme.border,
                gap: 4,
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: theme.text, fontWeight: "700" }}>{item.toolName}</Text>
                <Text style={{ color: colorByStatus, fontSize: 11, fontWeight: "800" }}>
                  {String(item.status).toUpperCase()}
                </Text>
              </View>
              {item.errorMessage ? (
                <Text style={{ color: theme.textMuted, fontSize: 11 }}>{item.errorMessage}</Text>
              ) : null}
              <Text style={{ color: theme.textMuted, fontSize: 10 }}>
                {item.durationMs}ms · {item.triggeredBy ?? "user"}
              </Text>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}
