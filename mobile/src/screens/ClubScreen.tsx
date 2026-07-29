import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { deviceTimezone } from "../convex";
import {
  useActions,
  useHome,
  useInvites,
  useMe,
  useSettings,
} from "../data";
import { statusGlyph } from "../lib";
import { registerForPushNotifications } from "../notifications";
import { colors, radius, serif, space } from "../theme";
import { Avatar, Btn, Muted, Pill } from "../ui";

/** Members, profile, invites, notification settings, sign out. */
export function ClubScreen() {
  const home = useHome();
  const isGhost = home?.viewerIsGhost ?? false;
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Members />
      <Profile />
      <Notifications isGhost={isGhost} />
      <InvitesSection />
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
          style={[
            styles.row,
            (i < home.members.length - 1 || home.ghosts.length > 0) &&
              styles.rowBorder,
          ]}
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
      {home.ghosts.map((g, i) => (
        <View
          key={g._id}
          style={[styles.row, i < home.ghosts.length - 1 && styles.rowBorder]}
        >
          <Avatar name={g.name} size={30} />
          <View style={styles.rowBody}>
            <Text style={styles.rowName}>
              {g.name}
              {g._id === home.viewerId ? "  (you)" : ""}
            </Text>
            <Muted>watches the club, owes nothing</Muted>
          </View>
          <Text style={styles.rowGlyph}>👻</Text>
        </View>
      ))}
      <Muted style={{ marginTop: space(2) }}>
        ⏳ = no word yet — their local day may still be young.
      </Muted>
    </View>
  );
}

// The club is scattered across US timezones; anything more exotic can be set
// on the web app (RN's Hermes may lack Intl.supportedValuesOf).
const COMMON_TIMEZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Phoenix",
  "America/Chicago",
  "America/New_York",
];

function Profile() {
  const me = useMe();
  const { updateProfile } = useActions();
  const [name, setName] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (me === undefined || me === null) {
    return null;
  }

  const zones = [
    ...new Set([...COMMON_TIMEZONES, deviceTimezone(), me.timezone ?? ""]),
  ].filter((z) => z.length > 0);
  const nameValue = name ?? me.name;
  const dirty = nameValue.trim() !== me.name && nameValue.trim().length > 0;

  const saveName = async () => {
    if (await updateProfile({ name: nameValue.trim() })) {
      setName(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  };

  const pickTimezone = async (tz: string) => {
    if (tz !== me.timezone) {
      await updateProfile({ timezone: tz });
    }
  };

  return (
    <View>
      <Text style={styles.heading}>You</Text>
      <Muted>
        Your timezone decides when your day ends — for pushups and section
        deadlines. Today for you: {me.today}.
      </Muted>
      <View style={styles.nameRow}>
        <TextInput
          style={styles.nameInput}
          value={nameValue}
          onChangeText={setName}
          placeholder="Display name"
          placeholderTextColor={colors.inkFaint}
          onSubmitEditing={() => dirty && void saveName()}
        />
        {dirty ? (
          <Pressable onPress={() => void saveName()}>
            <Text style={styles.saveLink}>Save</Text>
          </Pressable>
        ) : saved ? (
          <Text style={styles.savedNote}>Saved ✓</Text>
        ) : null}
      </View>
      <View style={styles.chipRow}>
        {zones.map((tz) => (
          <Chip
            key={tz}
            label={tz.split("/")[1]?.replace(/_/g, " ") ?? tz}
            selected={me.timezone === tz}
            onPress={() => void pickTimezone(tz)}
          />
        ))}
      </View>
      <Muted style={{ marginTop: space(1) }}>
        Somewhere else? Set any timezone on the web app.
      </Muted>
    </View>
  );
}

const REMINDER_CHOICES = ["18:00", "19:00", "20:00", "21:00", "22:00", "23:00"];

function Notifications(props: { isGhost: boolean }) {
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
            Hear when a section lands
            {props.isGhost
              ? " and when the club logs their stars."
              : ", know the moment it's your turn, and get a nudge before your day ends."}
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
      {!props.isGhost && (
        <Muted style={styles.prefNote}>
          “You're up” alerts always come through when it's your turn.
        </Muted>
      )}

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

      {!props.isGhost && (
        <>
          <View style={[styles.prefText, { marginTop: space(3) }]}>
            <Text style={styles.prefTitle}>Daily reminder</Text>
            <Muted>
              If you haven't reported by this time (your timezone), you get
              one nudge. Silence still costs ⛈️⛈️.
            </Muted>
          </View>
          <View style={styles.chipRow}>
            <Chip
              label="Off"
              selected={settings.reminderTime === null}
              onPress={() => updateSettings({ reminderTime: null })}
            />
            {REMINDER_CHOICES.map((time) => (
              <Chip
                key={time}
                label={time}
                selected={settings.reminderTime === time}
                onPress={() => updateSettings({ reminderTime: time })}
              />
            ))}
          </View>
        </>
      )}
    </View>
  );
}

function Chip(props: {
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
  const { createInvite } = useActions();
  const [forName, setForName] = useState("");
  const [minting, setMinting] = useState(false);

  const mint = async () => {
    setMinting(true);
    try {
      const code = await createInvite(forName.trim() || undefined);
      if (code !== null) {
        setForName("");
      }
    } finally {
      setMinting(false);
    }
  };

  return (
    <View>
      <Text style={styles.heading}>Invites</Text>
      <Muted>
        Mint a single-use code and send it however you like. Naming it
        pre-fills their display name.
      </Muted>
      {(invites ?? []).map((i) => (
        <View key={i._id} style={styles.inviteRow}>
          <Text style={styles.inviteCode}>{i.code}</Text>
          {i.forName && <Pill>for {i.forName}</Pill>}
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() =>
              void Share.share({
                message: `Join the club: download the app and enter invite code ${i.code}`,
              })
            }
          >
            <Text style={styles.saveLink}>Share</Text>
          </Pressable>
        </View>
      ))}
      <View style={styles.nameRow}>
        <TextInput
          style={styles.nameInput}
          value={forName}
          onChangeText={setForName}
          placeholder="Who's it for? (optional)"
          placeholderTextColor={colors.inkFaint}
        />
        <Pressable onPress={() => void mint()} disabled={minting}>
          <Text style={styles.saveLink}>
            {minting ? "Minting…" : "New code"}
          </Text>
        </Pressable>
      </View>
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
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(3),
    marginTop: space(2),
  },
  nameInput: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingVertical: space(2),
    fontSize: 15,
    color: colors.ink,
  },
  saveLink: { fontSize: 14, fontWeight: "700", color: colors.accent },
  savedNote: { fontSize: 14, color: colors.green, fontWeight: "600" },
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
    paddingVertical: space(2),
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
