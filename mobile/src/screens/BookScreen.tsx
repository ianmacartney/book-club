import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useBook } from "../data";
import { prettyDay } from "../lib";
import { colors, radius, serif, space } from "../theme";
import { Avatar, Muted, Pill } from "../ui";

/**
 * The organized view of the current book: jacket header, rotation with
 * progress, and the book's storm-cloud standings — set directly on the
 * paper, separated by whitespace and hairlines rather than cards.
 */
export function BookScreen() {
  const detail = useBook();

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

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.jacket}>
        <Text style={styles.jacketEyebrow}>Now reading</Text>
        <Text style={styles.jacketTitle}>{book.title}</Text>
        {book.author && <Text style={styles.jacketAuthor}>{book.author}</Text>}
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { flex: done }]} />
          <View style={{ flex: Math.max(sections.length - done, 0) }} />
        </View>
        <Muted style={styles.centered}>
          {done} of {sections.length} sections · started{" "}
          {prettyDay(book.startedDay)}
        </Muted>
        <Text style={styles.stakesText}>
          ☠️ {book.punishment}
          {book.suggestedBy ? `  — set by ${book.suggestedBy}` : ""}
        </Text>
      </View>

      <Text style={styles.sectionHeading}>The rotation</Text>
      <View>
        {sections.map((s, i) => {
          const isCurrent = current?.sectionId === s._id;
          const late = isCurrent ? (current?.daysLate ?? 0) : 0;
          return (
            <View
              key={s._id}
              style={[
                styles.row,
                i < sections.length - 1 && styles.rowBorder,
                isCurrent && styles.rowCurrent,
              ]}
            >
              <Text
                style={[
                  styles.rowMark,
                  s.submission !== null && styles.rowMarkDone,
                  isCurrent && styles.rowMarkCurrent,
                ]}
              >
                {s.submission !== null ? "✓" : isCurrent ? "◉" : "○"}
              </Text>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{s.title}</Text>
                <Muted>
                  {s.assigneeName}
                  {s.submission
                    ? s.submission.skip
                      ? ` · covered by ${s.submission.byName} ⛈️⛈️`
                      : ` · ${prettyDay(s.submission.day)}`
                    : s.dueDay
                      ? ` · due ${prettyDay(s.dueDay)}`
                      : ""}
                </Muted>
              </View>
              {isCurrent &&
                (late > 0 ? (
                  <Pill tone="warn">
                    {late}d late · {late * 2} ⛈️
                  </Pill>
                ) : (
                  <Pill tone="accent">up now</Pill>
                ))}
            </View>
          );
        })}
      </View>

      <Text style={styles.sectionHeading}>Standings — this book</Text>
      <View>
        {standings.map((s, i) => (
          <View
            key={s.userId}
            style={[styles.row, i < standings.length - 1 && styles.rowBorder]}
          >
            <Avatar name={s.name} size={28} />
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>
                {i === 0 && s.clouds > 0 ? "☠️ " : ""}
                {s.name}
              </Text>
            </View>
            <Text style={styles.clouds}>
              {s.clouds > 0 ? `${s.clouds} ⛈️` : "✨"}
            </Text>
          </View>
        ))}
        <Muted style={{ marginTop: space(2) }}>
          Most clouds when the last section lands owes the punishment.
        </Muted>
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
  centered: { textAlign: "center" },
});
