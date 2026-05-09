import { Text, View } from "react-native";
import KillSwitchButton from "./KillSwitchButton";
import { theme } from "../lib/theme";

export default function Header({ title }: { title: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: theme.bgSoft,
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
      }}
    >
      <View>
        <Text style={{ color: theme.copper, fontSize: 11, fontWeight: "700", letterSpacing: 2 }}>
          SOLOMON'S FORGE
        </Text>
        <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700", marginTop: 2 }}>{title}</Text>
      </View>
      <KillSwitchButton />
    </View>
  );
}
