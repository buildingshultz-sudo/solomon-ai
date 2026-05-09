import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Header from "../../src/components/Header";
import { api, getServerUrl, setServerUrl } from "../../src/lib/api";
import { theme } from "../../src/lib/theme";

export default function SettingsScreen() {
  const [url, setUrl] = useState("");
  const [healthy, setHealthy] = useState<null | boolean>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getServerUrl().then(setUrl);
  }, []);

  const test = async () => {
    setBusy(true);
    setHealthy(null);
    try {
      const r: any = await api.health();
      setHealthy(!!(r?.ok ?? r?.status === "ok" ?? r === "ok"));
    } catch {
      setHealthy(false);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!url.match(/^https?:\/\//)) {
      Alert.alert("Invalid URL", "URL must start with http:// or https://");
      return;
    }
    await setServerUrl(url);
    Alert.alert("Saved", "Server URL updated.");
    test();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={["top"]}>
      <Header title="Setup" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 18 }}>
        <View style={{ gap: 8 }}>
          <Text style={{ color: theme.copper, fontSize: 11, fontWeight: "800", letterSpacing: 1 }}>
            SERVER URL
          </Text>
          <Text style={{ color: theme.textMuted, fontSize: 12 }}>
            Where Solomon's Forge is running on your PC. Tailscale recommended:{" "}
            <Text style={{ color: theme.text }}>http://100.x.y.z:3737</Text>
          </Text>
          <TextInput
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="http://100.x.y.z:3737"
            placeholderTextColor={theme.textMuted}
            style={{
              backgroundColor: theme.card,
              color: theme.text,
              padding: 12,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: theme.border,
              fontSize: 14,
            }}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              onPress={save}
              style={({ pressed }) => ({
                flex: 1,
                backgroundColor: pressed ? theme.copperHi : theme.copper,
                padding: 12,
                borderRadius: 10,
                alignItems: "center",
              })}
            >
              <Text style={{ color: "#0d0d0e", fontWeight: "800" }}>SAVE</Text>
            </Pressable>
            <Pressable
              onPress={test}
              disabled={busy}
              style={{
                flex: 1,
                backgroundColor: theme.card,
                borderWidth: 1,
                borderColor: theme.border,
                padding: 12,
                borderRadius: 10,
                alignItems: "center",
                opacity: busy ? 0.6 : 1,
              }}
            >
              <Text style={{ color: theme.text, fontWeight: "700" }}>TEST CONNECTION</Text>
            </Pressable>
          </View>
          {healthy !== null && (
            <Text
              style={{
                color: healthy ? theme.green : theme.red,
                fontWeight: "800",
                marginTop: 4,
              }}
            >
              {healthy ? "✓ Connected" : "✗ Cannot reach server"}
            </Text>
          )}
        </View>

        <View style={{ height: 1, backgroundColor: theme.border }} />

        <View style={{ gap: 6 }}>
          <Text style={{ color: theme.copper, fontSize: 11, fontWeight: "800", letterSpacing: 1 }}>
            HOW TO REACH YOUR PC FROM HERE
          </Text>
          <Text style={{ color: theme.text, fontWeight: "700" }}>1. Tailscale (recommended)</Text>
          <Text style={{ color: theme.textMuted, fontSize: 12 }}>
            Run "Setup Remote Access (Tailscale).bat" on your PC. Install Tailscale on this phone
            and sign in with the same account. Use the http://100.x.y.z:3737 URL it prints.
          </Text>
          <Text style={{ color: theme.text, fontWeight: "700", marginTop: 8 }}>2. Cloudflare Tunnel</Text>
          <Text style={{ color: theme.textMuted, fontSize: 12 }}>
            Run "Setup Remote Access (Cloudflare Tunnel).bat". Use the https://*.trycloudflare.com URL.
          </Text>
        </View>

        <View style={{ height: 1, backgroundColor: theme.border }} />

        <View style={{ gap: 6 }}>
          <Text style={{ color: theme.copper, fontSize: 11, fontWeight: "800", letterSpacing: 1 }}>
            ABOUT
          </Text>
          <Text style={{ color: theme.text, fontSize: 13 }}>Solomon's Forge — Mobile</Text>
          <Text style={{ color: theme.textMuted, fontSize: 11 }}>v1.0.0 · Building Shultz / Shultz Enterprises</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
