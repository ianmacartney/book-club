import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { errorMessage, useClubId, useHome } from "../data";
import { colors, radius, space } from "../theme";
import { Btn, Card, Heading, Muted, Pill } from "../ui";

type Poll = NonNullable<FunctionReturnType<typeof api.polls.state>>;

function useTask() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function ErrorNote({ error }: { error: string | null }) {
  return error ? (
    <Text accessibilityRole="alert" style={styles.error}>
      {error}
    </Text>
  ) : null;
}

function confirmAction(title: string, message: string, action: () => void) {
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: "Continue", onPress: action },
  ]);
}

export function NextBookPoll() {
  const clubId = useClubId();
  const home = useHome();
  const poll = useQuery(api.polls.state, { clubId });
  if (poll === undefined || home === undefined)
    return <Muted>Loading book selection…</Muted>;
  if (!poll || (poll.status === "done" && !poll.winnerNominationId)) {
    return <OpenPoll canParticipate={!home.viewerIsGhost} />;
  }
  return (
    <View style={styles.stack}>
      {poll.status === "nominating" ? (
        <Nominations key={poll._id} poll={poll} />
      ) : poll.status === "done" ? (
        <Winner key={poll._id} poll={poll} />
      ) : (
        <Ballot key={`${poll._id}:${poll.ballotVersion}`} poll={poll} />
      )}
      <Results poll={poll} />
      {poll.startedBookId && <OpenPoll canParticipate={poll.canParticipate} />}
    </View>
  );
}

function OpenPoll({ canParticipate }: { canParticipate: boolean }) {
  const clubId = useClubId();
  const start = useMutation(api.polls.start);
  const [method, setMethod] = useState<"approval" | "ranked">("ranked");
  const task = useTask();
  return (
    <Card>
      <View style={styles.stack}>
        <Heading>Pick the next book</Heading>
        <Muted>
          Start in the last few sections of the current book. Nominate up to
          two; the winner’s nominator sets the sections and punishment
          afterward.
        </Muted>
        {canParticipate ? (
          <>
            <Text style={styles.label}>Voting format</Text>
            <Choice
              title="Ranked choice"
              selected={method === "ranked"}
              onPress={() => setMethod("ranked")}
              disabled={task.busy}
            />
            <Choice
              title="Two picks + final runoff"
              selected={method === "approval"}
              onPress={() => setMethod("approval")}
              disabled={task.busy}
            />
            <Muted>
              {method === "approval"
                ? "Vote for one or two books, including someone else’s. Then choose one of the top two."
                : "Rank books in preference order. Your vote transfers to your next remaining choice when a book is eliminated."}
            </Muted>
            <Btn
              disabled={task.busy}
              onPress={() => void task.run(() => start({ clubId, method }))}
            >
              Open nominations
            </Btn>
          </>
        ) : (
          <Muted>
            Active members can open nominations. You can follow along here.
          </Muted>
        )}
        <ErrorNote error={task.error} />
      </View>
    </Card>
  );
}

function Choice(props: {
  title: string;
  subtitle?: string;
  selected: boolean;
  rank?: number;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{
        selected: props.selected,
        disabled: props.disabled,
      }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={[
        styles.choice,
        props.selected && styles.selected,
        props.disabled && { opacity: 0.5 },
      ]}
    >
      <View style={styles.choiceBody}>
        <Text style={styles.bookTitle}>{props.title}</Text>
        {props.subtitle && <Muted>{props.subtitle}</Muted>}
      </View>
      <Text style={styles.check}>
        {props.selected ? (props.rank ? `#${props.rank}` : "✓") : "○"}
      </Text>
    </Pressable>
  );
}

function Nominations({ poll }: { poll: Poll }) {
  const nominate = useMutation(api.polls.nominate);
  const withdraw = useMutation(api.polls.withdrawNomination);
  const close = useMutation(api.polls.closeNominations);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const task = useTask();
  return (
    <Card>
      <View style={styles.stack}>
        <Heading>Nominations are open</Heading>
        <View style={styles.row}>
          <Pill>
            {poll.method === "ranked" ? "Ranked choice" : "Two picks + runoff"}
          </Pill>
          <Pill>{poll.nominations.length} books</Pill>
        </View>
        <Muted>
          {poll.myNominationCount}/2 of your suggestions used. Sections and
          punishment come after the vote.
        </Muted>
        {poll.nominations.map((n) => (
          <View key={n._id} style={styles.nomination}>
            <Text style={styles.bookTitle}>{n.title}</Text>
            <Muted>
              {n.author && `by ${n.author} · `}from {n.suggestedByName}
              {n.mine && " (you)"}
            </Muted>
            {n.mine && poll.canParticipate && (
              <Btn
                variant="ghost"
                disabled={task.busy}
                onPress={() =>
                  void task.run(() => withdraw({ nominationId: n._id }))
                }
              >
                Withdraw
              </Btn>
            )}
          </View>
        ))}
        {poll.canParticipate && poll.myNominationCount < 2 && (
          <>
            <Text style={styles.label}>Book title</Text>
            <TextInput
              accessibilityLabel="Book title"
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              maxLength={300}
              placeholder="Suggest a book"
              placeholderTextColor={colors.inkSoft}
            />
            <Text style={styles.label}>Author (optional)</Text>
            <TextInput
              accessibilityLabel="Author (optional)"
              style={styles.input}
              value={author}
              onChangeText={setAuthor}
              maxLength={300}
            />
            <Btn
              disabled={task.busy || !title.trim()}
              onPress={() =>
                void task.run(async () => {
                  await nominate({
                    pollId: poll._id,
                    title,
                    author: author || undefined,
                  });
                  setTitle("");
                  setAuthor("");
                })
              }
            >
              Nominate book
            </Btn>
          </>
        )}
        {poll.canManage && (
          <Btn
            variant="ghost"
            disabled={task.busy || poll.nominations.length < 2}
            onPress={() =>
              confirmAction(
                "Open voting?",
                "This closes nominations for everyone.",
                () => void task.run(() => close({ pollId: poll._id })),
              )
            }
          >
            Close nominations → voting
          </Btn>
        )}
        <ErrorNote error={task.error} />
      </View>
    </Card>
  );
}

function Ballot({ poll }: { poll: Poll }) {
  const cast = useMutation(api.polls.castVote);
  const close = useMutation(api.polls.closeRound);
  const [draft, setDraft] = useState<Id<"nominations">[] | null>(null);
  const selected = draft ?? poll.myVote ?? [];
  const task = useTask();
  const runoff = poll.status === "runoff";
  const ranked = !runoff && poll.method === "ranked";
  const shown = poll.nominations.filter((n) => !runoff || n.inRunoff);
  const title = (id: Id<"nominations">) =>
    shown.find((n) => n._id === id)?.title ?? "Book";
  const hasOther = selected.some((id) =>
    shown.some((n) => n._id === id && !n.mine),
  );
  const saved =
    poll.myVote !== null &&
    JSON.stringify(selected) === JSON.stringify(poll.myVote);
  const toggle = (id: Id<"nominations">) => {
    if (selected.includes(id)) setDraft(selected.filter((i) => i !== id));
    else if (runoff) setDraft([id]);
    else if (ranked || selected.length < 2) setDraft([...selected, id]);
  };
  const move = (i: number, direction: number) => {
    const next = [...selected];
    [next[i], next[i + direction]] = [next[i + direction], next[i]];
    setDraft(next);
  };
  const previous = poll.results.at(-1);
  return (
    <Card>
      <View style={styles.stack}>
        <Heading>
          {runoff
            ? "Final runoff — pick one"
            : ranked
              ? "Rank your choices"
              : "Choose up to two"}
        </Heading>
        <View style={styles.row}>
          <Pill>
            {poll.votesCast}/{poll.memberCount} voted
          </Pill>
        </View>
        {runoff &&
          previous &&
          (previous.label.startsWith("Runoff") ||
            previous.label.startsWith("Ranked")) && (
            <Text style={styles.notice}>
              The final was tied. Cast a fresh vote between these two books.
            </Text>
          )}
        <Muted>
          {runoff
            ? "One vote each. You may vote for your own nomination."
            : ranked
              ? "Select books in preference order, favorite first. Rank as many as you like, including at least one nominated by someone else. Unranked books get no preference."
              : "Choose one or two books. At least one must be someone else’s nomination. The top two advance to a final runoff."}
        </Muted>
        {shown.map((n) => (
          <Choice
            key={n._id}
            title={n.title}
            subtitle={`${n.author ? `by ${n.author} · ` : ""}from ${n.suggestedByName}${n.mine ? " (you)" : ""}`}
            selected={selected.includes(n._id)}
            rank={ranked ? selected.indexOf(n._id) + 1 : undefined}
            disabled={
              task.busy ||
              !poll.canParticipate ||
              (!selected.includes(n._id) &&
                !runoff &&
                !ranked &&
                selected.length === 2)
            }
            onPress={() => toggle(n._id)}
          />
        ))}
        {ranked && selected.length > 0 && (
          <View style={styles.stack}>
            <Text style={styles.label}>Your ranked ballot</Text>
            {selected.map((id, i) => (
              <View key={id} style={styles.rankRow}>
                <Text style={styles.rankTitle}>
                  {i + 1}. {title(id)}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${title(id)} up`}
                  disabled={i === 0 || task.busy}
                  onPress={() => move(i, -1)}
                  style={[
                    styles.arrow,
                    (i === 0 || task.busy) && { opacity: 0.3 },
                  ]}
                >
                  <Text style={styles.check}>↑</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${title(id)} down`}
                  disabled={i === selected.length - 1 || task.busy}
                  onPress={() => move(i, 1)}
                  style={[
                    styles.arrow,
                    (i === selected.length - 1 || task.busy) && {
                      opacity: 0.3,
                    },
                  ]}
                >
                  <Text style={styles.check}>↓</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
        {poll.canParticipate && (
          <>
            {!runoff && selected.length > 0 && !hasOther && (
              <Text style={styles.notice}>
                Include at least one book nominated by someone else.
              </Text>
            )}
            <Btn
              disabled={
                task.busy ||
                selected.length === 0 ||
                (!runoff && !hasOther) ||
                saved
              }
              onPress={() =>
                void task.run(async () => {
                  await cast({
                    pollId: poll._id,
                    nominationIds: selected,
                    ballotVersion: poll.ballotVersion,
                  });
                  setDraft(null);
                })
              }
            >
              {poll.myVote ? "Update ballot" : "Submit ballot"}
            </Btn>
            {saved ? (
              <Pill tone="ok">Ballot saved</Pill>
            ) : (
              poll.myVote && <Pill tone="warn">Unsaved changes</Pill>
            )}
            <Muted>
              You can change your ballot until the round closes. The last
              member’s vote closes it automatically.
            </Muted>
          </>
        )}
        {poll.canManage && (
          <Btn
            variant="ghost"
            disabled={task.busy || poll.votesCast === 0}
            onPress={() =>
              confirmAction(
                "Tally this round?",
                `${poll.votesCast} of ${poll.memberCount} ballots are in. Members who haven’t voted will miss this round.`,
                () =>
                  void task.run(() =>
                    close({
                      pollId: poll._id,
                      ballotVersion: poll.ballotVersion,
                    }),
                  ),
              )
            }
          >
            Close round and tally
          </Btn>
        )}
        <ErrorNote error={task.error} />
      </View>
    </Card>
  );
}

function Winner({ poll }: { poll: Poll }) {
  const winner = poll.nominations.find((n) => n.isWinner);
  const [editing, setEditing] = useState(false);
  const start = useMutation(api.polls.startWinningBook);
  const task = useTask();
  if (!winner) return null;
  return (
    <Card>
      <View style={styles.stack}>
        <View style={styles.row}>
          <Pill tone="ok">The next book</Pill>
        </View>
        <Heading>{winner.title}</Heading>
        <Muted>
          {winner.author && `by ${winner.author} · `}Nominated by{" "}
          {winner.suggestedByName}
        </Muted>
        {poll.startedBookId ? (
          <Muted>
            This winning book has been started. Find it in the Book tab or on
            the shelf.
          </Muted>
        ) : (
          <>
            <Muted>
              {winner.mine
                ? "Your book won. Set the sections and punishment, then start reading when the current book is finished."
                : `${winner.suggestedByName} will divide the book into sections and set the punishment before reading starts.`}
            </Muted>
            {poll.setup && (
              <View style={styles.nomination}>
                <Text style={styles.bookTitle}>
                  Ready to read · {poll.setup.sectionTitles.length} sections
                </Text>
                <Text style={styles.body}>☠️ {poll.setup.punishment}</Text>
                {poll.setup.sectionTitles.map((title, i) => (
                  <Muted key={i}>
                    {i + 1}. {title}
                  </Muted>
                ))}
              </View>
            )}
            {winner.mine && poll.canParticipate && (
              <>
                {!poll.setup || editing ? (
                  <Setup poll={poll} onSaved={() => setEditing(false)} />
                ) : (
                  <>
                    <Btn
                      variant="ghost"
                      disabled={task.busy}
                      onPress={() => setEditing(true)}
                    >
                      Edit sections & punishment
                    </Btn>
                    <Btn
                      disabled={task.busy || poll.clubIsReading}
                      onPress={() =>
                        confirmAction(
                          "Start reading?",
                          "The first reader’s two-day deadline starts today.",
                          () =>
                            void task.run(() => start({ pollId: poll._id })),
                        )
                      }
                    >
                      Start reading
                    </Btn>
                  </>
                )}
              </>
            )}
            {poll.clubIsReading && (
              <Muted>
                You can prepare the next book now. Reading can start once the
                current book is finished.
              </Muted>
            )}
          </>
        )}
        <ErrorNote error={task.error} />
      </View>
    </Card>
  );
}

function Setup({ poll, onSaved }: { poll: Poll; onSaved: () => void }) {
  const save = useMutation(api.polls.saveWinningBookSetup);
  const [sections, setSections] = useState(
    poll.setup?.sectionTitles.join("\n") ?? "",
  );
  const [punishment, setPunishment] = useState(poll.setup?.punishment ?? "");
  const task = useTask();
  return (
    <View style={styles.stack}>
      <Text style={styles.label}>Sections (one per line)</Text>
      <TextInput
        accessibilityLabel="Sections (one per line)"
        style={[styles.input, styles.sections]}
        multiline
        textAlignVertical="top"
        value={sections}
        onChangeText={setSections}
        placeholder={"Chapters 1–3\nChapters 4–6\nChapters 7–9"}
        placeholderTextColor={colors.inkSoft}
      />
      <Text style={styles.label}>Punishment for the most clouds</Text>
      <TextInput
        accessibilityLabel="Punishment for the most clouds"
        style={[styles.input, styles.punishment]}
        multiline
        textAlignVertical="top"
        maxLength={2000}
        value={punishment}
        onChangeText={setPunishment}
        placeholder="Karaoke. Full commitment."
        placeholderTextColor={colors.inkSoft}
      />
      <Muted>
        Sections rotate through members in join order, with two calendar days
        per turn. Saving this plan does not start the reading clock.
      </Muted>
      <Btn
        disabled={task.busy || !sections.trim() || !punishment.trim()}
        onPress={() =>
          void task.run(async () => {
            await save({
              pollId: poll._id,
              sectionTitles: sections
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
              punishment,
            });
            onSaved();
          })
        }
      >
        Save sections & punishment
      </Btn>
      <ErrorNote error={task.error} />
    </View>
  );
}

function Results({ poll }: { poll: Poll }) {
  const [open, setOpen] = useState(false);
  if (!poll.results.length && !poll.tieBreakOrder.length) return null;
  const title = (id: Id<"nominations">) =>
    poll.nominations.find((n) => n._id === id)?.title ?? "Book";
  return (
    <View style={styles.stack}>
      <Btn variant="ghost" onPress={() => setOpen(!open)}>
        {open ? "Hide" : "Show"}{" "}
        {poll.results.length ? "vote results & tie rules" : "tie rules"}
      </Btn>
      {open && (
        <Card>
          <View style={styles.stack}>
            <Muted>
              Ties for a finalist spot or ranked elimination use a random draw
              made before voting. Earlier books keep their place. A tied final
              gets a fresh vote.
            </Muted>
            {poll.tieBreakOrder.length > 0 && (
              <Muted>
                Draw order: {poll.tieBreakOrder.map(title).join(" → ")}
              </Muted>
            )}
            {poll.results.map((result, i) => (
              <View key={i} style={styles.nomination}>
                <Text style={styles.bookTitle}>{result.label}</Text>
                {result.counts.map((c) => (
                  <View key={c.nominationId} style={styles.rankRow}>
                    <Text style={styles.rankTitle}>
                      {title(c.nominationId)}
                    </Text>
                    <Text style={styles.body}>{c.votes}</Text>
                  </View>
                ))}
                {result.eliminatedNominationId && (
                  <Muted>
                    Eliminated: {title(result.eliminatedNominationId)}
                  </Muted>
                )}
                {result.exhaustedBallots > 0 && (
                  <Muted>
                    {result.exhaustedBallots} ballots have no remaining ranked
                    choices.
                  </Muted>
                )}
                {result.tieBreakUsed && (
                  <Muted>The published draw broke a tie.</Muted>
                )}
              </View>
            ))}
          </View>
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space(3) },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  label: { fontSize: 13, fontWeight: "600", color: colors.ink },
  body: { fontSize: 14, color: colors.ink },
  input: {
    borderWidth: 1,
    borderColor: colors.inkSoft,
    borderRadius: radius.sm,
    padding: space(3),
    color: colors.ink,
    fontSize: 16,
    backgroundColor: colors.card,
  },
  sections: { minHeight: 150 },
  punishment: { minHeight: 80 },
  nomination: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: space(3),
    gap: space(2),
  },
  choice: {
    borderWidth: 1,
    borderColor: colors.inkSoft,
    borderRadius: radius.sm,
    padding: space(3),
    flexDirection: "row",
    alignItems: "center",
    gap: space(3),
  },
  selected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  choiceBody: { flex: 1, gap: space(1) },
  bookTitle: { color: colors.ink, fontSize: 16, fontWeight: "600" },
  check: { color: colors.accent, fontSize: 20, fontWeight: "600" },
  rankRow: { flexDirection: "row", alignItems: "center", gap: space(2) },
  rankTitle: { flex: 1, color: colors.ink, fontSize: 14 },
  arrow: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.inkSoft,
    borderRadius: radius.sm,
  },
  notice: { color: colors.accent, fontSize: 14 },
  error: { color: "#A12A23", fontSize: 14 },
});
