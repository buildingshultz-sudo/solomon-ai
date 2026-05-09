import { useEffect, useState, useCallback } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Header from "../../src/components/Header";
import { api } from "../../src/lib/api";
import { theme } from "../../src/lib/theme";

export default function TasksScreen() {
  const [data, setData] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r: any = await api.tasksList();
      setData(Array.isArray(r) ? r : r?.tasks ?? []);
    } catch {
      setData([]);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={["top"]}>
      <Header title="Tasks" />
      {busy && data.length === 0 ? (
        <ActivityIndicator color={theme.copper} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => String(item.id)}
          refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={theme.copper} />}
          contentContainerStyle={{ padding: 12, gap: 8 }}
          ListEmptyComponent={
            <Text style={{ color: theme.textMuted, textAlign: "center", marginTop: 24 }}>
              No tasks. Ask Solomon to create one from the Chat tab.
            </Text>
          }
          renderItem={({ item }) => (
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
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: theme.text, fontWeight: "700", flex: 1 }}>{item.title}</Text>
                <Pressable
                  onPress={async () => {
                    try {
                      await api.taskComplete(item.id);
                      load();
                    } catch {}
                  }}
                  style={{
                    backgroundColor: theme.green,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 6,
                  }}
                >
                  <Text style={{ color: "#0d0d0e", fontWeight: "800", fontSize: 11 }}>DONE</Text>
                </Pressable>
              </View>
              <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                {item.priority ?? "normal"} · {item.project ?? "general"} · {item.status ?? "open"}
              </Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}
