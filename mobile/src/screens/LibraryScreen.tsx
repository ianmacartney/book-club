import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useShelf } from "../data";
import { yearOf } from "../lib";
import { colors, serif, space } from "../theme";
import { Muted, Pill } from "../ui";
import { BookScreen } from "./BookScreen";

/**
 * Every book the club has ever read, newest first, numbered from the
 * beginning of history. Tapping one opens its full page — the same Book-tab
 * view, read-only, with the frozen final standings and every section's notes.
 * Voting on the next book stays on the web app for now — the phone is for the
 * daily pulse.
 */
export function LibraryScreen() {
  const shelf = useShelf();
  const [openId, setOpenId] = useState<string | null>(null);

  if (openId !== null) {
    return <BookScreen bookId={openId} onBack={() => setOpenId(null)} />;
  }

  if (shelf === undefined) {
    return (
      <View style={styles.loading}>
        <Muted>Dusting the shelves…</Muted>
      </View>
    );
  }

  const numbered = shelf.map((b, i) => ({ ...b, number: shelf.length - i }));

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.title}>The Shelf</Text>
        <Pill>{shelf.length} books</Pill>
      </View>
      {shelf.length === 0 && (
        <Muted>
          Nothing here yet — finish your first book and it takes its place in
          history.
        </Muted>
      )}
      {numbered.map((b, i) => (
        <Pressable
          key={b._id}
          style={({ pressed }) => [
            styles.book,
            i < numbered.length - 1 && styles.bookBorder,
            pressed && styles.bookPressed,
          ]}
          onPress={() => setOpenId(b._id)}
        >
          <View style={styles.spine} />
          <View style={styles.bookBody}>
            <Text style={styles.bookTitle}>
              <Text style={styles.bookNumber}>№{b.number} </Text>
              {b.title}
            </Text>
            {b.author && <Text style={styles.bookAuthor}>{b.author}</Text>}
            <Muted>
              {yearOf(b.startedDay)}
              {yearOf(b.endedDay) !== yearOf(b.startedDay)
                ? `–${yearOf(b.endedDay)}`
                : ""}
              {b.status === "abandoned" ? " · abandoned 🪦" : ""}
            </Muted>
            {b.loserNames.length > 0 && (
              <Text style={styles.stakes}>
                ☠️ {b.loserNames.join(" & ")}: {b.punishment}
              </Text>
            )}
          </View>
        </Pressable>
      ))}
      <Muted style={styles.footer}>
        Suggesting and voting on the next book lives on the web app for now.
      </Muted>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space(5), paddingBottom: space(8) },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space(3),
  },
  title: { fontFamily: serif, fontSize: 24, color: colors.ink },
  book: { flexDirection: "row", gap: space(3), paddingVertical: space(3) },
  bookBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  bookPressed: { opacity: 0.55 },
  spine: {
    width: 3,
    borderRadius: 2,
    backgroundColor: colors.accent,
    opacity: 0.55,
  },
  bookBody: { flex: 1, gap: 2 },
  bookTitle: { fontFamily: serif, fontSize: 17, color: colors.ink },
  bookNumber: { color: colors.inkFaint },
  bookAuthor: { fontSize: 13, color: colors.inkSoft },
  stakes: { fontSize: 13, color: colors.ink, marginTop: space(1) },
  footer: { textAlign: "center", marginTop: space(4) },
});
