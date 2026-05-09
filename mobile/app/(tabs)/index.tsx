import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Header from "../../src/components/Header";
import { api } from "../../src/lib/api";
import { theme } from "../../src/lib/theme";

type Msg = { role: "user" | "assistant"; content: string };

export default function ChatScreen() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", content: text }]);
    setBusy(true);
    try {
      const res: any = await api.chatSend(text);
      const reply = res?.assistant ?? res?.assistantText ?? "(no reply)";
      setMsgs((m) => [...m, { role: "assistant", content: reply }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "assistant", content: `⚠ ${e?.message ?? String(e)}` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={["top"]}>
      <Header title="Chat" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={90}
      >
        <ScrollView style={{ flex: 1, padding: 12 }} contentContainerStyle={{ gap: 8 }}>
          {msgs.length === 0 && (
            <Text style={{ color: theme.textMuted, fontSize: 13, textAlign: "center", marginTop: 24 }}>
              Talk to Solomon. Ask about jobs, tasks, finances, or YouTube SEO.
            </Text>
          )}
          {msgs.map((m, i) => (
            <View
              key={i}
              style={{
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                backgroundColor: m.role === "user" ? theme.copper : theme.card,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 12,
                maxWidth: "85%",
              }}
            >
              <Text style={{ color: m.role === "user" ? "#0d0d0e" : theme.text }}>{m.content}</Text>
            </View>
          ))}
          {busy && <ActivityIndicator color={theme.copper} style={{ marginTop: 12 }} />}
        </ScrollView>
        <View
          style={{
            flexDirection: "row",
            gap: 8,
            padding: 12,
            borderTopWidth: 1,
            borderTopColor: theme.border,
          }}
        >
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Message Solomon…"
            placeholderTextColor={theme.textMuted}
            style={{
              flex: 1,
              backgroundColor: theme.card,
              color: theme.text,
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: theme.border,
            }}
            onSubmitEditing={send}
          />
          <Pressable
            onPress={send}
            disabled={busy}
            style={({ pressed }) => ({
              backgroundColor: pressed ? theme.copperHi : theme.copper,
              paddingHorizontal: 16,
              justifyContent: "center",
              borderRadius: 10,
              opacity: busy ? 0.6 : 1,
            })}
          >
            <Text style={{ color: "#0d0d0e", fontWeight: "800" }}>SEND</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
