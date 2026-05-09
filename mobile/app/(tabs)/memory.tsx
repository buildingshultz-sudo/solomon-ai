import { useEffect, useState, useCallback } from "react";
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Header from "../../src/components/Header";
import { api } from "../../src/lib/api";
import { theme } from "../../src/lib/theme";

export default function MemoryScreen() {
  const [data, setData] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r: any = await api.memoryList();
      setData(Array.isArray(r) ? r : r?.items ?? []);
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
      <Header title="Memory" />
      <FlatList
        data={data}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={theme.copper} />}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        ListEmptyComponent={
          busy ? null : (
            <Text style={{ color: theme.textMuted, textAlign: "center", marginTop: 24 }}>
              Memory is empty. Use Manus Import on the desktop to seed it.
            </Text>
          )
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
            <Text style={{ color: theme.copper, fontSize: 10, fontWeight: "800", letterSpacing: 1 }}>
              {(item.category ?? "general").toUpperCase()}
            </Text>
            <Text style={{ color: theme.text, fontWeight: "700" }}>{item.title}</Text>
            <Text style={{ color: theme.textMuted, fontSize: 12 }} numberOfLines={3}>
              {item.content}
            </Text>
          </View>
        )}
      />
      {busy && data.length === 0 && <ActivityIndicator color={theme.copper} style={{ marginTop: 24 }} />}
    </SafeAreaView>
  );
}
