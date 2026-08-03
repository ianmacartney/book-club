import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useBook } from "../data";
import { prettyDay } from "../lib";
import { colors, radius, serif, space } from "../theme";
import { Avatar, Muted, Pill } from "../ui";

/**
 * The organized view of a book: jacket header, the club's storm-cloud
 * standings, then the rotation — each submitted section expandable to reveal
 * its quotes and thoughts. Set directly on the paper, separated by whitespace
 * and hairlines rather than cards.
 *
 * With no `bookId` it follows the club's active book (the Book tab). Given a
 * `bookId` + `onBack` it becomes a past book's page, opened from the Library —
 * the same layout, read-only, showing the frozen final standings.
 */
export function BookScreen(props: { bookId?: string; onBack?: () => void }) {
  const detail = useBook(props.bookId);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (id: string) =>
    setOpen((prev) => ({ ...prev, [id]: !prev[id] }));

  if (detail === undefined) {
    return (
      <View style={styles.loading}>
        <Muted>Fetching the book…</Muted>
      </View>
    );
  }
  if (detail === null) {
    return (
      <View style={styles.loading}>
        <Text style={styles.jacketTitle}>No book on the go</Text>
        <Muted style={styles.centered}>
          Pick the next one together on the web app — the feed will announce
          it here.
        </Muted>
      </View>
    );
  }

  const { book, sections, current, standings } = detail;
  const done = sections.filter((s) => s.submission !== null).length;
  const isActive = book.status === "active";
  const eyebrow = isActive
    ? "Now reading"
    : book.status === "finished"
      ? "Finished"
      : "Abandoned";
  const loserIds = new Set(book.result?.loserIds ?? []);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {props.onBack && (
        <Pressable style={styles.back} onPress={props.onBack} hitSlop={8}>
          <Ionicons name="chevron-back" size={20} color={colors.accent} />
          <Text style={styles.backText}>The Shelf</Text>
        </Pressable>
      )}

      <View style={styles.jacket}>
        <Text style={styles.jacketEyebrow}>{eyebrow}</Text>
        <Text style={styles.jacketTitle}>{book.title}</Text>
        {book.author && <Text style={styles.jacketAuthor}>{book.author}</Text>}
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { flex: done }]} />
          <View style={{ flex: Math.max(sections.length - done, 0) }} />
        </View>
        <Muted style={styles.centered}>
          {done} of {sections.length} sections ·{" "}
          {isActive
            ? `started ${prettyDay(book.startedDay)}`
            : `${prettyDay(book.startedDay)} – ${prettyDay(
                book.endedDay ?? book.startedDay,
              )}`}
        </Muted>
        <Text style={styles.stakesText}>
          ☠️ {book.punishment}
          {book.suggestedBy ? `  — set by ${book.suggestedBy}` : ""}
        </Text>
      </View>

      <Text style={styles.sectionHeading}>
        {isActive ? "Standings — this book" : "Final standings"}
      </Text>
      <View>
        {standings.map((s, i) => {
          const isLoser = book.result
            ? loserIds.has(s.userId)
            : i === 0 && s.clouds > 0;
          return (
            <View
              key={s.userId}
              style={[styles.row, i < standings.length - 1 && styles.rowBorder]}
            >
              <Avatar name={s.name} size={28} />
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>
                  {isLoser ? "☠️ " : ""}
                  {s.name}
                </Text>
              </View>
              <Text style={styles.clouds}>
                {s.clouds > 0 ? `${s.clouds} ⛈️` : "✨"}
              </Text>
            </View>
          );
        })}
        {isActive && (
          <Muted style={{ marginTop: space(2) }}>
            Most clouds when the last section lands owes the punishment.
          </Muted>
        )}
      </View>

      <Text style={styles.sectionHeading}>The rotation</Text>
      <View>
        {sections.map((s, i) => {
          const isCurrent = current?.sectionId === s._id;
          const late = isCurrent ? (current?.daysLate ?? 0) : 0;
          const sub = s.submission;
          const isOpen = sub !== null && open[s._id];
          const meta = sub
            ? sub.skip
              ? ` · covered by ${sub.byName} ⛈️⛈️`
              : ` · ${prettyDay(sub.day)}`
            : s.dueDay
              ? ` · due ${prettyDay(s.dueDay)}`
              : "";
          const rowInner = (
            <>
              <Text
                style={[
                  styles.rowMark,
                  sub !== null && styles.rowMarkDone,
                  isCurrent && styles.rowMarkCurrent,
                ]}
              >
                {sub !== null ? "✓" : isCurrent ? "◉" : "○"}
              </Text>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{s.title}</Text>
                <Muted>
                  {s.assigneeName}
                  {meta}
                </Muted>
              </View>
              {isCurrent ? (
                late > 0 ? (
                  <Pill tone="warn">
                    {late}d late · {late * 2} ⛈️
                  </Pill>
                ) : (
                  <Pill tone="accent">up now</Pill>
                )
              ) : sub !== null ? (
                <Ionicons
                  name={isOpen ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={colors.inkFaint}
                />
              ) : null}
            </>
          );
          return (
            <View
              key={s._id}
              style={i < sections.length - 1 && styles.rowBorder}
            >
              {sub !== null ? (
                <Pressable
                  style={[styles.row, isCurrent && styles.rowCurrent]}
                  onPress={() => toggle(s._id)}
                >
                  {rowInner}
                </Pressable>
              ) : (
                <View style={[styles.row, isCurrent && styles.rowCurrent]}>
                  {rowInner}
                </View>
              )}
              {isOpen && sub && (
                <View style={styles.notes}>
                  {sub.quotes.length > 0 && (
                    <View style={styles.quoteBlock}>
                      <Text style={styles.quoteText}>{sub.quotes}</Text>
                    </View>
                  )}
                  {sub.thoughts.length > 0 ? (
                    <Text style={styles.thoughtsText}>{sub.thoughts}</Text>
                  ) : (
                    sub.quotes.length === 0 && (
                      <Muted>No notes left for this one.</Muted>
                    )
                  )}
                </View>
              )}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space(5), gap: space(3), paddingBottom: space(8) },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space(3),
    padding: space(8),
  },
  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(0.5),
    marginBottom: space(1),
  },
  backText: { fontSize: 15, fontWeight: "600", color: colors.accent },
  jacket: { alignItems: "center", gap: space(1.5), paddingVertical: space(4) },
  jacketEyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: colors.accent,
  },
  jacketTitle: {
    fontFamily: serif,
    fontSize: 30,
    color: colors.ink,
    textAlign: "center",
  },
  jacketAuthor: { fontFamily: serif, fontSize: 15, color: colors.inkSoft },
  progressTrack: {
    flexDirection: "row",
    alignSelf: "stretch",
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.stormSoft,
    overflow: "hidden",
    marginTop: space(3),
    marginHorizontal: space(6),
  },
  progressFill: { backgroundColor: colors.accent },
  stakesText: {
    fontSize: 13,
    color: colors.ink,
    textAlign: "center",
    marginTop: space(2),
  },
  sectionHeading: {
    fontFamily: serif,
    fontSize: 18,
    color: colors.ink,
    marginTop: space(4),
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
  rowCurrent: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    paddingHorizontal: space(2),
    marginHorizontal: -space(2),
  },
  rowMark: {
    width: 20,
    textAlign: "center",
    fontSize: 15,
    color: colors.inkFaint,
  },
  rowMarkDone: { color: colors.green },
  rowMarkCurrent: { color: colors.accent },
  rowBody: { flex: 1, gap: 1 },
  rowTitle: { fontSize: 15, fontWeight: "600", color: colors.ink },
  clouds: { fontSize: 15, fontWeight: "600", color: colors.storm },
  notes: {
    marginLeft: space(8),
    gap: space(2),
    paddingBottom: space(3),
    paddingRight: space(2),
  },
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
  centered: { textAlign: "center" },
});
