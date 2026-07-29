import { useMemo, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useActions, useBook, useFeed, useHome } from "../data";
import { prettyDay, statusGlyph } from "../lib";
import { colors, radius, serif, space } from "../theme";
import { Btn, Muted, Rule } from "../ui";
import { Avatar } from "../ui";
import type { FeedEvent } from "../types";

/**
 * The club as it actually lives: a feed. Stars and storms roll in as light
 * avatar-and-emoji marks, section write-ups arrive as letters (quotes set in
 * serif), Sunday tallies and book milestones sit centered like system
 * messages. General chat messages will slot into the same stream later.
 * Ornament is kept to a minimum — spacing and alignment do the separating.
 */

type Row =
  | { key: string; kind: "day"; day: string }
  | {
      key: string;
      kind: "checkins";
      events: Extract<FeedEvent, { type: "checkin" }>[];
    }
  | { key: string; kind: "event"; event: FeedEvent };

function buildRows(events: FeedEvent[]): Row[] {
  const rows: Row[] = [];
  let day = "";
  for (const event of events) {
    if (event.day !== day) {
      day = event.day;
      rows.push({ key: `day-${day}`, kind: "day", day });
    }
    const last = rows[rows.length - 1];
    if (event.type === "checkin") {
      if (last.kind === "checkins") {
        last.events.push(event);
      } else {
        rows.push({
          key: `checkins-${event.day}-${event.at}`,
          kind: "checkins",
          events: [event],
        });
      }
    } else {
      rows.push({
        key: `${event.type}-${event.day}-${event.at}`,
        kind: "event",
        event,
      });
    }
  }
  // Inverted list: newest renders at the bottom.
  return rows.reverse();
}

export function FeedScreen() {
  const { events, hasMore, loadOlder } = useFeed();
  const rows = useMemo(() => (events ? buildRows(events) : []), [events]);

  if (events === undefined) {
    return (
      <View style={styles.loading}>
        <Muted>Reading the archives…</Muted>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={({ item }) => <FeedRow row={item} />}
        inverted
        // Hold the reader's place: older pages appending at the array end
        // and fresh events landing at index 0 must not shift the viewport.
        // Near the bottom (visual "top" of an inverted list), snap to new
        // events like a chat.
        maintainVisibleContentPosition={{
          minIndexForVisible: 0,
          autoscrollToTopThreshold: 100,
        }}
        onEndReached={() => hasMore && loadOlder()}
        onEndReachedThreshold={0.6}
        ListFooterComponent={
          hasMore ? (
            <Muted style={styles.archiveNote}>Reaching further back…</Muted>
          ) : (
            <Rule label="the beginning" />
          )
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
      <Composer />
    </View>
  );
}

function FeedRow(props: { row: Row }) {
  const { row } = props;
  switch (row.kind) {
    case "day":
      return <Rule label={prettyDay(row.day)} />;
    case "checkins":
      return <CheckinCluster events={row.events} />;
    case "event":
      return <EventItem event={row.event} />;
  }
}

function CheckinCluster(props: {
  events: Extract<FeedEvent, { type: "checkin" }>[];
}) {
  return (
    <View style={styles.cluster}>
      {props.events.map((e) => (
        <View key={`${e.userId}-${e.at}`} style={styles.mark}>
          <Avatar name={e.name} size={24} />
          <Text style={styles.markGlyph}>{statusGlyph[e.status]}</Text>
        </View>
      ))}
    </View>
  );
}

function EventItem(props: { event: FeedEvent }) {
  const { event } = props;
  switch (event.type) {
    case "submission":
      return (
        <View style={styles.entry}>
          <Avatar name={event.name} size={30} />
          <View style={styles.entryBody}>
            <Text style={styles.entryName}>
              {event.name}
              <Text style={styles.entryMeta}>
                {"  "}finished “{event.sectionTitle}”
                {event.skip ? ` for ${event.assigneeName} ⛈️⛈️` : ""}
              </Text>
            </Text>
            {event.quotes.length > 0 && (
              <View style={styles.quoteBlock}>
                <Text style={styles.quoteText}>{event.quotes}</Text>
              </View>
            )}
            {event.thoughts.length > 0 && (
              <Text style={styles.thoughtsText}>{event.thoughts}</Text>
            )}
            {event.isLastSection && (
              <Text style={styles.lastSection}>— the final section 📕</Text>
            )}
          </View>
        </View>
      );
    case "weekSummary":
      return (
        <View style={styles.system}>
          <Text style={styles.systemTitle}>Sunday Tally</Text>
          {event.entries.map((e) => (
            <View key={e.name} style={styles.tallyRow}>
              <Text style={styles.tallyName}>{e.name}</Text>
              <Text style={styles.tallyClouds}>
                {e.weekClouds > 0 ? `${e.weekClouds} ⛈️` : "clear ✨"}
                {e.bookClouds > 0 ? `   ${e.bookClouds} this book` : ""}
              </Text>
            </View>
          ))}
        </View>
      );
    case "bookStarted":
      return (
        <View style={styles.system}>
          <Text style={styles.milestoneFlourish}>❦</Text>
          <Text style={styles.milestoneTitle}>{event.bookTitle}</Text>
          {event.author && <Muted style={styles.centered}>by {event.author}</Muted>}
          <Muted style={styles.centered}>
            {event.suggestedByName
              ? `${event.suggestedByName} opens the book. `
              : ""}
            ☠️ {event.punishment}
          </Muted>
        </View>
      );
    case "bookEnded":
      return (
        <View style={styles.system}>
          <Text style={styles.milestoneFlourish}>
            {event.status === "finished" ? "❦" : "🪦"}
          </Text>
          <Text style={styles.milestoneTitle}>
            {event.bookTitle} — {event.status}
          </Text>
          <Muted style={styles.centered}>
            {event.loserNames.length > 0
              ? `${event.loserNames.join(" & ")} owes: ${event.punishment} ☠️`
              : event.status === "finished"
                ? "A spotless book — nobody owes the punishment 🎉"
                : "Shelved unfinished."}
          </Muted>
        </View>
      );
    case "checkin":
      return null; // handled by CheckinCluster
  }
}

// ---------------------------------------------------------------------------
// Composer: today's check-in + "you're up" section entry point
// ---------------------------------------------------------------------------

function Composer() {
  const home = useHome();
  const book = useBook();
  const { checkIn } = useActions();
  const [writing, setWriting] = useState(false);

  const viewer = home?.members.find((m) => m._id === home.viewerId);
  // Ghosts watch the feed; they have nothing to report and no turns.
  if (home === undefined || home.viewerIsGhost || viewer === undefined) {
    return null;
  }

  const currentSection =
    book && book.current !== null
      ? (book.sections.find((s) => s._id === book.current!.sectionId) ?? null)
      : null;
  const myTurn = currentSection?.assignedTo === home.viewerId;
  const canSkip =
    currentSection !== null &&
    !myTurn &&
    (book?.current?.daysLate ?? 0) > 0 &&
    book?.current?.skipperId === home.viewerId;

  const chosen = viewer.checkinToday;

  return (
    <View style={styles.composer}>
      {(myTurn || canSkip) && currentSection && (
        <Pressable style={styles.turnBanner} onPress={() => setWriting(true)}>
          <Text style={styles.turnText}>
            {myTurn
              ? `📖 You're up: “${currentSection.title}”`
              : `📖 ${currentSection.assigneeName} is overdue — cover “${currentSection.title}”`}
            {currentSection.dueDay && myTurn
              ? ` · due ${prettyDay(currentSection.dueDay)}`
              : ""}
          </Text>
          <Text style={styles.turnCta}>Write it →</Text>
        </Pressable>
      )}
      {!viewer.isPushupDay ? (
        <Muted style={styles.centered}>Sunday — rest day 😴</Muted>
      ) : (
        <>
          <View style={styles.checkinRow}>
            <Pressable
              onPress={() => checkIn("star")}
              style={({ pressed }) => [
                styles.emojiBtn,
                chosen === "star" && styles.emojiChosenStar,
                pressed && styles.emojiPressed,
              ]}
            >
              <Text
                style={[
                  styles.emoji,
                  chosen === "storm" && styles.emojiDimmed,
                ]}
              >
                ⭐️
              </Text>
            </Pressable>
            <Pressable
              onPress={() => checkIn("storm")}
              style={({ pressed }) => [
                styles.emojiBtn,
                chosen === "storm" && styles.emojiChosenStorm,
                pressed && styles.emojiPressed,
              ]}
            >
              <Text
                style={[styles.emoji, chosen === "star" && styles.emojiDimmed]}
              >
                ⛈️
              </Text>
            </Pressable>
          </View>
          {chosen === null && (
            <Muted style={styles.centered}>
              Report before your midnight — silence costs ⛈️⛈️
            </Muted>
          )}
        </>
      )}
      {currentSection && (
        <SubmitModal
          visible={writing}
          onClose={() => setWriting(false)}
          sectionId={currentSection._id}
          sectionTitle={currentSection.title}
          bookTitle={book?.book.title ?? ""}
          skipFor={canSkip ? currentSection.assigneeName : null}
        />
      )}
    </View>
  );
}

function SubmitModal(props: {
  visible: boolean;
  onClose: () => void;
  sectionId: string;
  sectionTitle: string;
  bookTitle: string;
  skipFor: string | null;
}) {
  const { submitSection } = useActions();
  const [quotes, setQuotes] = useState("");
  const [thoughts, setThoughts] = useState("");

  return (
    <Modal
      visible={props.visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={props.onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.modal}
      >
        <View style={styles.modalHeader}>
          <Pressable onPress={props.onClose}>
            <Text style={styles.modalCancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.modalTitle}>“{props.sectionTitle}”</Text>
          <View style={{ width: 50 }} />
        </View>
        <Muted style={styles.centered}>{props.bookTitle}</Muted>
        {props.skipFor && (
          <Muted style={styles.skipNote}>
            You're covering for {props.skipFor} — they take ⛈️⛈️ extra for the
            skip.
          </Muted>
        )}
        <Text style={styles.fieldLabel}>Quotes</Text>
        <TextInput
          style={[styles.input, styles.inputQuotes]}
          multiline
          placeholder="Lines worth keeping…"
          placeholderTextColor={colors.inkFaint}
          value={quotes}
          onChangeText={setQuotes}
        />
        <Text style={styles.fieldLabel}>Thoughts</Text>
        <TextInput
          style={[styles.input, styles.inputThoughts]}
          multiline
          placeholder="What did you make of it?"
          placeholderTextColor={colors.inkFaint}
          value={thoughts}
          onChangeText={setThoughts}
        />
        <Btn
          disabled={thoughts.trim().length === 0}
          onPress={() => {
            submitSection(props.sectionId, quotes.trim(), thoughts.trim());
            setQuotes("");
            setThoughts("");
            props.onClose();
          }}
        >
          {props.skipFor ? "Submit for them (skip)" : "Submit my section"}
        </Btn>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: {
    paddingHorizontal: space(4),
    paddingTop: space(4), // inverted: this is the visual bottom
    paddingBottom: space(2),
  },
  archiveNote: { textAlign: "center", paddingVertical: space(3) },
  cluster: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: space(4),
    rowGap: space(2),
    marginBottom: space(4),
  },
  mark: { flexDirection: "row", alignItems: "center", gap: space(1) },
  markGlyph: { fontSize: 15 },
  entry: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space(3),
    marginBottom: space(5),
    paddingRight: space(4),
  },
  entryBody: { flex: 1, gap: space(2) },
  entryName: { fontSize: 14, fontWeight: "700", color: colors.accent },
  entryMeta: { fontWeight: "400", color: colors.inkSoft, fontSize: 13 },
  quoteBlock: {
    borderLeftWidth: 2,
    borderLeftColor: colors.gold,
    paddingLeft: space(3),
    paddingVertical: space(0.5),
  },
  quoteText: {
    fontFamily: serif,
    fontStyle: "italic",
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink,
  },
  thoughtsText: { fontSize: 14, lineHeight: 20, color: colors.ink },
  lastSection: { fontSize: 13, color: colors.inkSoft, fontStyle: "italic" },
  system: {
    alignItems: "center",
    gap: space(1),
    marginBottom: space(5),
    marginHorizontal: space(6),
  },
  systemTitle: {
    fontFamily: serif,
    fontSize: 15,
    color: colors.inkSoft,
    marginBottom: space(1),
    letterSpacing: 0.5,
  },
  tallyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignSelf: "stretch",
    paddingVertical: 1,
  },
  tallyName: { fontSize: 14, fontWeight: "600", color: colors.ink },
  tallyClouds: { fontSize: 14, color: colors.inkSoft },
  milestoneFlourish: { fontSize: 18, color: colors.accent },
  milestoneTitle: {
    fontFamily: serif,
    fontSize: 18,
    color: colors.ink,
    textAlign: "center",
  },
  centered: { textAlign: "center" },
  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    paddingVertical: space(2.5),
    paddingHorizontal: space(4),
    gap: space(2),
  },
  turnBanner: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    padding: space(3),
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space(2),
  },
  turnText: { flex: 1, fontSize: 13, fontWeight: "600", color: colors.ink },
  turnCta: { fontSize: 13, fontWeight: "700", color: colors.accent },
  checkinRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: space(10),
  },
  emojiBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  emojiChosenStar: { backgroundColor: colors.goldSoft },
  emojiChosenStorm: { backgroundColor: colors.stormSoft },
  emojiPressed: { transform: [{ scale: 0.92 }] },
  emoji: { fontSize: 34 },
  emojiDimmed: { opacity: 0.35 },
  modal: {
    flex: 1,
    backgroundColor: colors.paper,
    padding: space(4),
    gap: space(2),
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: space(1),
  },
  modalCancel: { fontSize: 15, color: colors.accent, width: 50 },
  modalTitle: { fontFamily: serif, fontSize: 17, color: colors.ink },
  skipNote: { textAlign: "center" },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.inkSoft,
    marginTop: space(2),
  },
  input: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingVertical: space(2),
    fontSize: 15,
    color: colors.ink,
    textAlignVertical: "top",
  },
  inputQuotes: { minHeight: 70, fontFamily: serif, fontStyle: "italic" },
  inputThoughts: { minHeight: 110 },
});
