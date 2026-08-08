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
  useMyAbsences,
  useSettings,
  useToday,
} from "../data";
import {
  addDays,
  diffDays,
  prettyDay,
  pushupDaysBetween,
  statusGlyph,
} from "../lib";
import { registerForPushNotifications } from "../notifications";
import { colors, radius, serif, space } from "../theme";
import type { OffGridPeriod } from "../types";
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
      {!isGhost && <OffGrid />}
      <Notifications isGhost={isGhost} />
      <InvitesSection />
      <Feedback />
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
            <Muted>
              {m.offGrid
                ? `⛈️ off the grid until ${prettyDay(m.offGrid.toDay)}`
                : (m.timezone ?? "timezone unknown")}
            </Muted>
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

/** How far ahead the start-day chips reach; the stepper covers the rest. */
const START_CHOICES = 14;
const MAX_AWAY_DAYS = 90; // matches MAX_OFF_GRID_DAYS on the backend

function rangeLabel(fromDay: string, toDay: string): string {
  return fromDay === toDay
    ? prettyDay(fromDay)
    : `${prettyDay(fromDay)} → ${prettyDay(toDay)}`;
}

/**
 * Declare, reschedule, and call off your own absences. No date picker: that
 * would be a native module, and a native module can't ride an OTA update out
 * to the club. Chips for the start, a stepper for the length.
 */
function OffGrid() {
  const today = useToday();
  const periods = useMyAbsences();
  const { declareAbsence, updateAbsence, cancelAbsence } = useActions();
  // A period id while editing that one, "new" while declaring, else null.
  const [editing, setEditing] = useState<string | null>(null);

  const confirmCancel = (period: OffGridPeriod) => {
    Alert.alert(
      period.active ? "Back early?" : "Drop this absence?",
      period.active
        ? "It'll end yesterday, so today counts normally again. The days you were away keep the ⛈️ they were billed."
        : rangeLabel(period.fromDay, period.toDay),
      [
        { text: "Keep it", style: "cancel" },
        {
          text: period.active ? "I'm back" : "Drop it",
          style: "destructive",
          onPress: () => void cancelAbsence(period._id),
        },
      ],
    );
  };

  return (
    <View>
      <Text style={styles.heading}>Off the grid</Text>
      <Muted>
        Heading somewhere without service? Say so before you go and each day
        away costs one ⛈️ instead of the 2 clouds silence costs — and if you
        find a bar of signal, a ⭐️ still beats it. Reading deadlines don't
        move.
      </Muted>

      {periods?.map((p) =>
        editing === p._id ? (
          <AbsenceEditor
            key={p._id}
            today={today}
            initial={p}
            // An absence under way has been reckoned day by day already;
            // only its end is still in play.
            lockStart={p.active}
            saveLabel="Save"
            onCancel={() => setEditing(null)}
            onSave={async (values) => {
              const ok = await updateAbsence({
                periodId: p._id,
                fromDay: values.fromDay,
                toDay: values.toDay,
                note: values.note.trim() || null,
              });
              if (ok) {
                setEditing(null);
              }
            }}
          />
        ) : (
          <View key={p._id} style={styles.absenceRow}>
            <View style={styles.rowBody}>
              <Text style={styles.rowName}>
                {rangeLabel(p.fromDay, p.toDay)}
              </Text>
              {p.note ? <Muted>{p.note}</Muted> : null}
            </View>
            {p.active ? <Pill tone="warn">Away now</Pill> : null}
            <Pressable onPress={() => setEditing(p._id)} hitSlop={8}>
              <Text style={styles.saveLink}>Edit</Text>
            </Pressable>
            <Pressable onPress={() => confirmCancel(p)} hitSlop={8}>
              <Text style={styles.dangerLink}>
                {p.active ? "I'm back" : "Drop"}
              </Text>
            </Pressable>
          </View>
        ),
      )}

      {editing === "new" ? (
        <AbsenceEditor
          today={today}
          initial={{ fromDay: today, toDay: today, note: null }}
          saveLabel="Declare"
          onCancel={() => setEditing(null)}
          onSave={async (values) => {
            const ok = await declareAbsence({
              fromDay: values.fromDay,
              toDay: values.toDay,
              note: values.note.trim() || undefined,
            });
            if (ok) {
              setEditing(null);
            }
          }}
        />
      ) : editing === null ? (
        <Btn
          variant="ghost"
          onPress={() => setEditing("new")}
          style={{ marginTop: space(3) }}
        >
          {periods?.length ? "➕ Another absence" : "➕ Declare an absence"}
        </Btn>
      ) : null}
    </View>
  );
}

function AbsenceEditor(props: {
  today: string;
  initial: { fromDay: string; toDay: string; note: string | null };
  lockStart?: boolean;
  saveLabel: string;
  onSave: (values: { fromDay: string; toDay: string; note: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [fromDay, setFromDay] = useState(props.initial.fromDay);
  const [toDay, setToDay] = useState(props.initial.toDay);
  const [note, setNote] = useState(props.initial.note ?? "");
  const [saving, setSaving] = useState(false);

  const days = diffDays(toDay, fromDay) + 1;
  const charged = pushupDaysBetween(fromDay, toDay);
  const starts = Array.from({ length: START_CHOICES }, (_, i) =>
    addDays(props.today, i),
  );

  const pickStart = (day: string) => {
    setFromDay(day);
    // A start dragged past the end takes the end with it.
    if (day > toDay) {
      setToDay(day);
    }
  };

  const stretch = (n: number) => {
    const next = addDays(toDay, n);
    if (next >= fromDay && diffDays(next, fromDay) + 1 <= MAX_AWAY_DAYS) {
      setToDay(next);
    }
  };

  return (
    <View style={styles.editor}>
      {props.lockStart ? (
        <Muted>Away since {prettyDay(fromDay)} — you can move the end.</Muted>
      ) : (
        <>
          <Text style={styles.editorLabel}>First day away</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.startRow}
          >
            {starts.map((day, i) => (
              <Chip
                key={day}
                label={
                  i === 0 ? "Today" : i === 1 ? "Tomorrow" : prettyDay(day)
                }
                selected={fromDay === day}
                onPress={() => pickStart(day)}
              />
            ))}
          </ScrollView>
        </>
      )}

      <Text style={styles.editorLabel}>How long</Text>
      <View style={styles.stepperRow}>
        <Pressable
          onPress={() => stretch(-1)}
          style={styles.stepBtn}
          hitSlop={6}
        >
          <Text style={styles.stepGlyph}>−</Text>
        </Pressable>
        <Text style={styles.stepValue}>
          {days} {days === 1 ? "day" : "days"}
        </Text>
        <Pressable
          onPress={() => stretch(1)}
          style={styles.stepBtn}
          hitSlop={6}
        >
          <Text style={styles.stepGlyph}>+</Text>
        </Pressable>
      </View>
      <Muted>
        {rangeLabel(fromDay, toDay)} — {charged} ⛈️ instead of the {charged * 2}{" "}
        clouds silence would cost
        {charged < days ? " (Sundays are free)" : ""}.
      </Muted>

      <TextInput
        style={styles.noteInput}
        value={note}
        onChangeText={setNote}
        placeholder="Note (optional) — e.g. no signal"
        placeholderTextColor={colors.inkFaint}
      />

      <View style={styles.editorActions}>
        <Btn variant="ghost" onPress={props.onCancel} style={{ flex: 1 }}>
          Cancel
        </Btn>
        <Btn
          onPress={() => {
            setSaving(true);
            void props
              .onSave({ fromDay, toDay, note })
              .finally(() => setSaving(false));
          }}
          disabled={saving}
          style={{ flex: 1 }}
        >
          {saving ? "Saving…" : props.saveLabel}
        </Btn>
      </View>
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

function Feedback() {
  const { submitFeedback } = useActions();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const send = async () => {
    const trimmed = message.trim();
    if (trimmed.length === 0) {
      return;
    }
    setSending(true);
    try {
      if (await submitFeedback(trimmed)) {
        setMessage("");
        setSent(true);
        setTimeout(() => setSent(false), 2500);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <View>
      <Text style={styles.heading}>Feedback</Text>
      <Muted>
        Something broken, missing, or annoying? Tell us — it goes straight to
        whoever's tending the app.
      </Muted>
      <TextInput
        style={styles.feedbackInput}
        value={message}
        onChangeText={(t) => {
          setMessage(t);
          setSent(false);
        }}
        placeholder="What's on your mind?"
        placeholderTextColor={colors.inkFaint}
        multiline
        textAlignVertical="top"
      />
      <View style={styles.feedbackActions}>
        {sent ? <Text style={styles.savedNote}>Sent — thanks ✓</Text> : null}
        <View style={{ flex: 1 }} />
        <Btn
          onPress={() => void send()}
          disabled={sending || message.trim().length === 0}
        >
          {sending ? "Sending…" : "Send feedback"}
        </Btn>
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
  absenceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(3),
    paddingVertical: space(2.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  editor: {
    marginTop: space(3),
    padding: space(3),
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    gap: space(2),
  },
  editorLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.inkFaint,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: space(1),
  },
  startRow: { flexDirection: "row", gap: space(2), paddingVertical: space(1) },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(4),
  },
  stepBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.stormSoft,
  },
  stepGlyph: { fontSize: 20, fontWeight: "700", color: colors.ink },
  stepValue: {
    fontFamily: serif,
    fontSize: 17,
    color: colors.ink,
    minWidth: 72,
    textAlign: "center",
  },
  noteInput: {
    marginTop: space(1),
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space(3),
    paddingVertical: space(2.5),
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.card,
  },
  editorActions: {
    flexDirection: "row",
    gap: space(3),
    marginTop: space(1),
  },
  dangerLink: { fontSize: 14, fontWeight: "600", color: colors.accent },
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
  feedbackInput: {
    marginTop: space(3),
    minHeight: 96,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: space(3),
    fontSize: 15,
    color: colors.ink,
  },
  feedbackActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(3),
    marginTop: space(3),
  },
  footer: { textAlign: "center" },
  signOut: {
    textAlign: "center",
    color: colors.inkSoft,
    fontSize: 14,
    paddingVertical: space(1),
  },
});
