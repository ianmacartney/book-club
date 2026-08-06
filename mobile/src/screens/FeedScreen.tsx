import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { FeedEvent, FeedReply } from "../types";

/**
 * The club as it actually lives: a feed. Stars and storms roll in as light
 * avatar-and-emoji marks, section write-ups arrive as letters (quotes set in
 * serif), Sunday tallies and book milestones sit centered like system
 * messages. Replies nest under the write-up they answer; tapping Reply turns
 * the check-in composer into a message box aimed at that thread.
 * Ornament is kept to a minimum — spacing and alignment do the separating.
 */

/** The write-up a reply is being typed at. */
type ReplyTarget = {
  sectionId: string;
  sectionTitle: string;
  writerName: string;
};

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
        // Two replies can share a millisecond; their ids can't.
        key:
          event.type === "reply"
            ? `reply-${event.replyId}`
            : `${event.type}-${event.day}-${event.at}`,
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
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const renderRow = useCallback(
    ({ item }: { item: Row }) => <FeedRow row={item} onReply={setReplyTo} />,
    [],
  );

  if (events === undefined) {
    return (
      <View style={styles.loading}>
        <Muted>Reading the archives…</Muted>
      </View>
    );
  }

  return (
    // The tab bar sits below us, and KeyboardAvoidingView measures its own
    // frame, so "padding" lifts the composer to exactly the keyboard's top.
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.container}
    >
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={renderRow}
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
      {replyTo === null ? (
        <Composer />
      ) : (
        <ReplyBar target={replyTo} onDismiss={() => setReplyTo(null)} />
      )}
    </KeyboardAvoidingView>
  );
}

function FeedRow(props: { row: Row; onReply: (to: ReplyTarget) => void }) {
  const { row } = props;
  switch (row.kind) {
    case "day":
      return <Rule label={prettyDay(row.day)} />;
    case "checkins":
      return <CheckinCluster events={row.events} />;
    case "event":
      return <EventItem event={row.event} onReply={props.onReply} />;
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

function EventItem(props: {
  event: FeedEvent;
  onReply: (to: ReplyTarget) => void;
}) {
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
            {event.replies.length > 0 && (
              <View style={styles.thread}>
                {event.replies.map((reply) => (
                  <ReplyLine key={reply.replyId} reply={reply} />
                ))}
              </View>
            )}
            <ReplyCta
              onPress={() =>
                props.onReply({
                  sectionId: event.sectionId,
                  sectionTitle: event.sectionTitle,
                  writerName: event.name,
                })
              }
            />
          </View>
        </View>
      );
    // A reply that outlived its write-up's window: it names what it answers
    // instead of nesting under it.
    case "reply":
      return (
        <View style={styles.entry}>
          <Avatar name={event.name} size={30} />
          <View style={styles.entryBody}>
            <Text style={styles.entryName}>
              {event.name}
              <Text style={styles.entryMeta}>
                {"  "}on {event.writerName}'s “{event.sectionTitle}”
              </Text>
            </Text>
            <Text style={styles.thoughtsText}>{event.body}</Text>
            <ReplyCta
              onPress={() =>
                props.onReply({
                  sectionId: event.sectionId,
                  sectionTitle: event.sectionTitle,
                  writerName: event.writerName,
                })
              }
            />
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

function ReplyLine(props: { reply: FeedReply }) {
  return (
    <View style={styles.replyLine}>
      <Avatar name={props.reply.name} size={20} />
      <Text style={styles.replyBody}>
        <Text style={styles.replyName}>{props.reply.name}</Text>
        {"  "}
        {props.reply.body}
      </Text>
    </View>
  );
}

function ReplyCta(props: { onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} hitSlop={8} style={styles.replyCtaHit}>
      <Text style={styles.replyCta}>Reply</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Composer: today's check-in + "you're up" section entry point, or — while a
// thread is picked — a message box aimed at it
// ---------------------------------------------------------------------------

function ReplyBar(props: { target: ReplyTarget; onDismiss: () => void }) {
  const { postReply } = useActions();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const input = useRef<TextInput>(null);

  // Also refocus when the reader aims at a different thread without the bar
  // ever unmounting.
  useEffect(() => {
    input.current?.focus();
  }, [props.target.sectionId]);

  const ready = body.trim().length > 0 && !sending;
  const send = async () => {
    const text = body.trim();
    if (text.length === 0 || sending) {
      return;
    }
    // Clear straight away so it reads like chat; hand the draft back if the
    // server turns it down.
    setBody("");
    setSending(true);
    const ok = await postReply(props.target.sectionId, text);
    setSending(false);
    if (!ok) {
      setBody(text);
    }
  };

  return (
    <View style={styles.composer}>
      <View style={styles.replyingTo}>
        <Text style={styles.replyingToText} numberOfLines={1}>
          Replying to {props.target.writerName}'s “{props.target.sectionTitle}”
        </Text>
        <Pressable onPress={props.onDismiss} hitSlop={10}>
          <Text style={styles.replyingToClose}>✕</Text>
        </Pressable>
      </View>
      <View style={styles.replyRow}>
        <TextInput
          ref={input}
          style={styles.replyInput}
          multiline
          placeholder="Say something…"
          placeholderTextColor={colors.inkFaint}
          value={body}
          onChangeText={setBody}
        />
        <Pressable
          onPress={send}
          disabled={!ready}
          style={({ pressed }) => [
            styles.sendBtn,
            !ready && styles.sendBtnOff,
            pressed && { opacity: 0.75 },
          ]}
        >
          <Text style={styles.sendBtnText}>Send</Text>
        </Pressable>
      </View>
    </View>
  );
}

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
  thread: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.inkFaint,
    paddingLeft: space(3),
    marginTop: space(1),
    gap: space(2),
  },
  replyLine: { flexDirection: "row", alignItems: "flex-start", gap: space(2) },
  replyBody: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.ink },
  replyName: { fontWeight: "700", color: colors.accent },
  replyCtaHit: { alignSelf: "flex-start" },
  replyCta: { fontSize: 12, fontWeight: "700", color: colors.inkFaint },
  replyingTo: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    backgroundColor: colors.accentSoft,
    borderRadius: radius.sm,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
  },
  replyingToText: { flex: 1, fontSize: 12, color: colors.inkSoft },
  replyingToClose: { fontSize: 13, fontWeight: "700", color: colors.inkSoft },
  replyRow: { flexDirection: "row", alignItems: "flex-end", gap: space(2) },
  replyInput: {
    flex: 1,
    maxHeight: 120,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: space(3),
    paddingTop: space(2),
    paddingBottom: space(2),
    fontSize: 15,
    color: colors.ink,
    textAlignVertical: "top",
  },
  sendBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: space(4),
    paddingVertical: space(2.5),
  },
  sendBtnOff: { opacity: 0.35 },
  sendBtnText: { fontSize: 15, fontWeight: "600", color: colors.white },
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
