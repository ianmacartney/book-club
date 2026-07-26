import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useActions, useHome, useInvites, useSettings } from "../data";
import { statusGlyph } from "../lib";
import { registerForPushNotifications } from "../notifications";
import { colors, radius, serif, space } from "../theme";
import { Avatar, Btn, Muted, Pill } from "../ui";

/** Members, invites, notification settings, sign out. */
export function ClubScreen() {
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Members />
      <Notifications />
      <InvitesSection />
      <Muted style={styles.footer}>
        Profile, timezone, and club administration live on the web app.
      </Muted>
      <SignOut />
    </ScrollView>
  );
}

function Members() {
  const home = useHome();
  if (home === undefined) {
    return <Muted style={styles.footer}>Opening the club…</Muted>;
  }
  return (
    <View>
      <Text style={styles.heading}>The club today</Text>
      {home.members.map((m, i) => (
        <View
          key={m._id}
          style={[styles.row, i < home.members.length - 1 && styles.rowBorder]}
        >
          <Avatar name={m.name} size={30} />
          <View style={styles.rowBody}>
            <Text style={styles.rowName}>
              {m.name}
              {m._id === home.viewerId ? "  (you)" : ""}
            </Text>
            <Muted>{m.timezone ?? "timezone unknown"}</Muted>
          </View>
          <Text style={styles.rowGlyph}>
            {!m.isPushupDay
              ? "😴"
              : m.checkinToday !== null
                ? statusGlyph[m.checkinToday]
                : "⏳"}
          </Text>
        </View>
      ))}
      <Muted style={{ marginTop: space(2) }}>
        ⏳ = no word yet — their local day may still be young.
      </Muted>
    </View>
  );
}

const REMINDER_CHOICES = ["18:00", "19:00", "20:00", "21:00", "22:00"];

function Notifications() {
  const settings = useSettings();
  const { updateSettings, registerPushToken } = useActions();
  const [registering, setRegistering] = useState(false);

  if (settings === undefined) {
    return null;
  }

  const enablePush = async () => {
    setRegistering(true);
    try {
      const token = await registerForPushNotifications();
      if (token === null) {
        Alert.alert(
          "Notifications are off",
          "Enable notifications for Push Up Club in Settings to get nudges. (Simulators can't receive push.)",
        );
        return;
      }
      await registerPushToken(token);
    } finally {
      setRegistering(false);
    }
  };

  return (
    <View>
      <Text style={styles.heading}>Notifications</Text>

      {!settings.hasToken && (
        <View style={styles.enableBlock}>
          <Muted>
            Get a nudge before your day ends, hear when a section lands, and
            know the moment it's your turn to read.
          </Muted>
          <Btn onPress={() => void enablePush()} disabled={registering}>
            {registering ? "Enabling…" : "🔔 Enable notifications"}
          </Btn>
        </View>
      )}

      <View style={styles.prefRow}>
        <View style={styles.prefText}>
          <Text style={styles.prefTitle}>Section submissions</Text>
          <Muted>When someone finishes their section or a book wraps up.</Muted>
        </View>
        <Switch
          value={settings.notifyOnSubmissions}
          onValueChange={(v) => updateSettings({ notifyOnSubmissions: v })}
          trackColor={{ true: colors.accent }}
        />
      </View>
      <Muted style={styles.prefNote}>
        “You're up” alerts always come through when it's your turn.
      </Muted>

      <View style={styles.prefRow}>
        <View style={styles.prefText}>
          <Text style={styles.prefTitle}>Stars from the club</Text>
          <Muted>A ⭐️ every time someone logs their pushups.</Muted>
        </View>
        <Switch
          value={settings.notifyOnStars}
          onValueChange={(v) => updateSettings({ notifyOnStars: v })}
          trackColor={{ true: colors.accent }}
        />
      </View>

      <View style={[styles.prefText, { marginTop: space(3) }]}>
        <Text style={styles.prefTitle}>Daily reminder</Text>
        <Muted>
          If you haven't reported by this time (your timezone), you get one
          nudge. Silence still costs ⛈️⛈️.
        </Muted>
      </View>
      <View style={styles.chipRow}>
        <ReminderChip
          label="Off"
          selected={settings.reminderTime === null}
          onPress={() => updateSettings({ reminderTime: null })}
        />
        {REMINDER_CHOICES.map((time) => (
          <ReminderChip
            key={time}
            label={time}
            selected={settings.reminderTime === time}
            onPress={() => updateSettings({ reminderTime: time })}
          />
        ))}
      </View>
    </View>
  );
}

function ReminderChip(props: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      style={[styles.chip, props.selected && styles.chipSelected]}
    >
      <Text
        style={[styles.chipLabel, props.selected && styles.chipLabelSelected]}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

function InvitesSection() {
  const invites = useInvites();
  if (invites === undefined || invites.length === 0) {
    return null;
  }
  return (
    <View>
      <Text style={styles.heading}>Open invites</Text>
      {invites.map((i) => (
        <View key={i._id} style={styles.inviteRow}>
          <Text style={styles.inviteCode}>{i.code}</Text>
          {i.forName && <Pill>for {i.forName}</Pill>}
        </View>
      ))}
      <Muted style={{ marginTop: space(1) }}>
        Mint new codes from the web app.
      </Muted>
    </View>
  );
}

function SignOut() {
  const { signOut } = useAuthActions();
  return (
    <Pressable
      onPress={() =>
        Alert.alert("Sign out?", "You can sign back in any time.", [
          { text: "Cancel", style: "cancel" },
          {
            text: "Sign out",
            style: "destructive",
            onPress: () => void signOut(),
          },
        ])
      }
    >
      <Text style={styles.signOut}>Sign out</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: space(5), gap: space(6), paddingBottom: space(8) },
  heading: {
    fontFamily: serif,
    fontSize: 18,
    color: colors.ink,
    marginBottom: space(2),
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(3),
    paddingVertical: space(2.5),
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  rowBody: { flex: 1, gap: 1 },
  rowName: { fontSize: 15, fontWeight: "600", color: colors.ink },
  rowGlyph: { fontSize: 17 },
  enableBlock: { gap: space(3), marginBottom: space(4) },
  prefRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(3),
    marginTop: space(3),
  },
  prefText: { flex: 1, gap: 2 },
  prefTitle: { fontSize: 15, fontWeight: "600", color: colors.ink },
  prefNote: { marginTop: space(1) },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space(2),
    marginTop: space(2.5),
  },
  chip: {
    borderRadius: radius.full,
    paddingHorizontal: space(3.5),
    paddingVertical: space(1.5),
    backgroundColor: colors.stormSoft,
  },
  chipSelected: { backgroundColor: colors.accent },
  chipLabel: { fontSize: 13, fontWeight: "600", color: colors.inkSoft },
  chipLabelSelected: { color: colors.white },
  inviteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(3),
    paddingVertical: space(1.5),
  },
  inviteCode: {
    fontSize: 18,
    letterSpacing: 3,
    fontVariant: ["tabular-nums"],
    color: colors.ink,
    fontWeight: "600",
  },
  footer: { textAlign: "center" },
  signOut: {
    textAlign: "center",
    color: colors.inkSoft,
    fontSize: 14,
    paddingVertical: space(1),
  },
});
