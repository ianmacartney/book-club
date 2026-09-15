import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { errorMessage } from "./lib";
import { Button, Card, ErrorNote, Field, Pill, inputClass } from "./ui";

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

export function NextBookPoll(props: {
  clubId: Id<"clubs">;
  canParticipate?: boolean;
}) {
  const poll = useQuery(api.polls.state, { clubId: props.clubId });
  if (poll === undefined)
    return (
      <p className="py-8 text-center text-ink/60">Loading book selection…</p>
    );
  if (!poll || (poll.status === "done" && !poll.winnerNominationId)) {
    return (
      <OpenPoll
        clubId={props.clubId}
        canParticipate={props.canParticipate ?? true}
      />
    );
  }
  return (
    <div className="space-y-4">
      {poll.status === "nominating" ? (
        <Nominating key={poll._id} poll={poll} />
      ) : poll.status === "done" ? (
        <Done key={poll._id} poll={poll} />
      ) : (
        <Voting key={`${poll._id}:${poll.ballotVersion}`} poll={poll} />
      )}
      <Results poll={poll} />
      {poll.startedBookId && (
        <OpenPoll clubId={props.clubId} canParticipate={poll.canParticipate} />
      )}
    </div>
  );
}

function OpenPoll(props: { clubId: Id<"clubs">; canParticipate: boolean }) {
  const start = useMutation(api.polls.start);
  const [method, setMethod] = useState<"approval" | "ranked">("ranked");
  const task = useTask();
  return (
    <Card>
      <h2 className="mb-1 text-lg font-bold">Pick the next book</h2>
      <p className="mb-4 text-sm text-ink/70">
        Start in the last few sections of the current book. Everyone can
        nominate up to two books; the winner’s nominator sets the sections and
        punishment afterward.
      </p>
      {props.canParticipate ? (
        <>
          <Field label="Voting format">
            <select
              className={inputClass}
              value={method}
              onChange={(e) => setMethod(e.target.value as typeof method)}
              disabled={task.busy}
            >
              <option value="ranked">Ranked choice</option>
              <option value="approval">Two picks + final runoff</option>
            </select>
          </Field>
          <p className="my-3 text-sm text-ink/70">
            {method === "approval"
              ? "Vote for one or two books, including at least one from someone else. Then choose one of the top two."
              : "Rank as many books as you like, including someone else’s. Your vote transfers to your next remaining choice when a book is eliminated."}
          </p>
          <Button
            disabled={task.busy}
            onClick={() =>
              void task.run(() => start({ clubId: props.clubId, method }))
            }
          >
            Open nominations
          </Button>
          <ErrorNote error={task.error} />
        </>
      ) : (
        <p className="text-sm text-ink/60">
          Active members can open nominations. You can follow along here.
        </p>
      )}
    </Card>
  );
}

function Nominating({ poll }: { poll: Poll }) {
  const nominate = useMutation(api.polls.nominate);
  const withdraw = useMutation(api.polls.withdrawNomination);
  const close = useMutation(api.polls.closeNominations);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const task = useTask();
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Nominations are open</h2>
        <Pill>
          {poll.method === "ranked" ? "Ranked choice" : "Two picks + runoff"}
        </Pill>
      </div>
      <p className="mb-4 text-sm text-ink/70">
        {poll.nominations.length} nominated · {poll.myNominationCount}/2 of your
        suggestions used. Sections and punishment come after the vote.
      </p>
      <ul className="space-y-2">
        {poll.nominations.map((n) => (
          <li
            key={n._id}
            className="flex items-center justify-between gap-3 rounded-xl border border-ink/20 p-3"
          >
            <div>
              <p className="font-semibold">{n.title}</p>
              <p className="text-sm text-ink/60">
                {n.author && `by ${n.author} · `}from {n.suggestedByName}
                {n.mine && " (you)"}
              </p>
            </div>
            {n.mine && poll.canParticipate && (
              <Button
                variant="ghost"
                disabled={task.busy}
                onClick={() =>
                  void task.run(() => withdraw({ nominationId: n._id }))
                }
              >
                Withdraw
              </Button>
            )}
          </li>
        ))}
      </ul>
      {poll.canParticipate && poll.myNominationCount < 2 && (
        <form
          className="mt-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void task.run(async () => {
              await nominate({
                pollId: poll._id,
                title,
                author: author || undefined,
              });
              setTitle("");
              setAuthor("");
            });
          }}
        >
          <Field label="Book title">
            <input
              className={inputClass}
              required
              maxLength={300}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label="Author (optional)">
            <input
              className={inputClass}
              maxLength={300}
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={task.busy || !title.trim()}>
            Nominate book
          </Button>
        </form>
      )}
      {poll.canManage && (
        <div className="mt-5 border-t border-ink/20 pt-4">
          <Button
            variant="ghost"
            disabled={task.busy || poll.nominations.length < 2}
            onClick={() => {
              if (confirm("Close nominations for everyone and open voting?"))
                void task.run(() => close({ pollId: poll._id }));
            }}
          >
            Close nominations → start voting
          </Button>
        </div>
      )}
      <ErrorNote error={task.error} />
    </Card>
  );
}

function Voting({ poll }: { poll: Poll }) {
  const cast = useMutation(api.polls.castVote);
  const close = useMutation(api.polls.closeRound);
  const [draft, setDraft] = useState<Id<"nominations">[] | null>(null);
  const selected = draft ?? poll.myVote ?? [];
  const task = useTask();
  const runoff = poll.status === "runoff";
  const ranked = !runoff && poll.method === "ranked";
  const shown = poll.nominations.filter((n) => !runoff || n.inRunoff);
  const hasOther = selected.some((id) =>
    shown.some((n) => n._id === id && !n.mine),
  );
  const valid = selected.length > 0 && (runoff || hasOther);
  const saved =
    poll.myVote !== null &&
    JSON.stringify(selected) === JSON.stringify(poll.myVote);
  const toggle = (id: Id<"nominations">) => {
    if (selected.includes(id)) setDraft(selected.filter((i) => i !== id));
    else if (runoff) setDraft([id]);
    else if (ranked || selected.length < 2) setDraft([...selected, id]);
  };
  const move = (index: number, delta: number) => {
    const next = [...selected];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    setDraft(next);
  };
  const previous = poll.results.at(-1);
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">
          {runoff
            ? "Final runoff — pick one"
            : ranked
              ? "Rank your choices"
              : "Choose up to two"}
        </h2>
        <Pill>
          {poll.votesCast}/{poll.memberCount} voted
        </Pill>
      </div>
      {runoff &&
        previous &&
        (previous.label.startsWith("Runoff") ||
          previous.label.startsWith("Ranked")) && (
          <p className="mb-3 font-medium text-amber-800">
            The final was tied. Cast a fresh vote between these two books.
          </p>
        )}
      <p className="mb-4 text-sm text-ink/70">
        {runoff
          ? "One vote each. You may vote for your own nomination."
          : ranked
            ? "Select books in preference order, favorite first. Rank as many as you like, including at least one nominated by someone else. Unranked books get no preference."
            : "Choose one or two books. At least one must be someone else’s nomination. The top two advance to a final runoff."}
      </p>
      <ul className="space-y-2">
        {shown.map((n) => {
          const index = selected.indexOf(n._id);
          const checked = index !== -1;
          return (
            <li key={n._id}>
              <button
                type="button"
                aria-pressed={checked}
                disabled={
                  !poll.canParticipate ||
                  task.busy ||
                  (!checked && !ranked && !runoff && selected.length === 2)
                }
                onClick={() => toggle(n._id)}
                className={`w-full rounded-xl border p-3 text-left disabled:opacity-50 ${checked ? "border-accent bg-accent/5" : "border-ink/20"}`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{n.title}</span>
                  <span>
                    {ranked && checked ? `#${index + 1}` : checked ? "✓" : "○"}
                  </span>
                </span>
                <span className="text-sm text-ink/60">
                  {n.author && `by ${n.author} · `}from {n.suggestedByName}
                  {n.mine && " (you)"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {ranked && selected.length > 0 && (
        <ol className="mt-4 space-y-2" aria-label="Your ranked ballot">
          {selected.map((id, i) => (
            <li
              key={id}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span>
                {i + 1}. {shown.find((n) => n._id === id)?.title}
              </span>
              <span className="flex gap-2">
                <button
                  aria-label={`Move ${shown.find((n) => n._id === id)?.title} up`}
                  disabled={i === 0 || task.busy}
                  className="rounded border border-ink/20 px-3 py-2 disabled:opacity-30"
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  aria-label={`Move ${shown.find((n) => n._id === id)?.title} down`}
                  disabled={i === selected.length - 1 || task.busy}
                  className="rounded border border-ink/20 px-3 py-2 disabled:opacity-30"
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      {poll.canParticipate && (
        <>
          {!runoff && selected.length > 0 && !hasOther && (
            <p className="mt-3 text-sm text-amber-800">
              Include at least one book nominated by someone else.
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              disabled={task.busy || !valid || saved}
              onClick={() =>
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
            </Button>
            {saved ? (
              <Pill tone="ok">Ballot saved</Pill>
            ) : (
              poll.myVote && <Pill tone="warn">Unsaved changes</Pill>
            )}
          </div>
          <p className="mt-3 text-xs text-ink/60">
            You can change your ballot until the round closes. The last member’s
            vote closes it automatically.
          </p>
        </>
      )}
      {poll.canManage && (
        <div className="mt-4 border-t border-ink/20 pt-4">
          <Button
            variant="ghost"
            disabled={task.busy || poll.votesCast === 0}
            onClick={() => {
              if (
                confirm(
                  `Tally now with ${poll.votesCast} of ${poll.memberCount} ballots? Members who haven’t voted will miss this round.`,
                )
              ) {
                void task.run(() =>
                  close({
                    pollId: poll._id,
                    ballotVersion: poll.ballotVersion,
                  }),
                );
              }
            }}
          >
            Close round and tally
          </Button>
        </div>
      )}
      <ErrorNote error={task.error} />
    </Card>
  );
}

function Done({ poll }: { poll: Poll }) {
  const winner = poll.nominations.find((n) => n.isWinner);
  const [editing, setEditing] = useState(false);
  const start = useMutation(api.polls.startWinningBook);
  const task = useTask();
  if (!winner) return null;
  return (
    <Card>
      <Pill tone="ok">The next book</Pill>
      <h2 className="mt-2 text-xl font-bold">{winner.title}</h2>
      <p className="mt-1 text-sm text-ink/70">
        {winner.author && `by ${winner.author} · `}Nominated by{" "}
        {winner.suggestedByName}
      </p>
      {poll.startedBookId ? (
        <p className="mt-4 text-sm">
          This winning book has been started. Find it in the Book tab or on the
          shelf.
        </p>
      ) : (
        <>
          <p className="my-4 text-sm text-ink/70">
            {winner.mine
              ? "Your book won. Set the sections and punishment, then start reading when the current book is finished."
              : `${winner.suggestedByName} will divide the book into sections and set the punishment before reading starts.`}
          </p>
          {poll.setup && (
            <div className="my-4 rounded-xl bg-paper p-4">
              <p className="font-semibold">
                Ready to read · {poll.setup.sectionTitles.length} sections
              </p>
              <p className="mt-1 text-sm">☠️ {poll.setup.punishment}</p>
              <ol className="mt-2 list-inside list-decimal text-sm text-ink/70">
                {poll.setup.sectionTitles.map((title, i) => (
                  <li key={i}>{title}</li>
                ))}
              </ol>
            </div>
          )}
          {winner.mine && poll.canParticipate && (
            <>
              {!poll.setup || editing ? (
                <WinningBookSetup
                  poll={poll}
                  onSaved={() => setEditing(false)}
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    disabled={task.busy}
                    onClick={() => setEditing(true)}
                  >
                    Edit sections & punishment
                  </Button>
                  <Button
                    disabled={task.busy || poll.clubIsReading}
                    onClick={() => {
                      if (
                        confirm(
                          "Start this book now? The first reader’s two-day deadline starts today.",
                        )
                      )
                        void task.run(() => start({ pollId: poll._id }));
                    }}
                  >
                    Start reading
                  </Button>
                </div>
              )}
            </>
          )}
          {poll.clubIsReading && (
            <p className="mt-3 text-sm text-ink/60">
              You can prepare the next book now. Reading can start once the
              current book is finished.
            </p>
          )}
        </>
      )}
      <ErrorNote error={task.error} />
    </Card>
  );
}

function WinningBookSetup({
  poll,
  onSaved,
}: {
  poll: Poll;
  onSaved: () => void;
}) {
  const save = useMutation(api.polls.saveWinningBookSetup);
  const [sections, setSections] = useState(
    poll.setup?.sectionTitles.join("\n") ?? "",
  );
  const [punishment, setPunishment] = useState(poll.setup?.punishment ?? "");
  const task = useTask();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
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
        });
      }}
    >
      <Field label="Sections (one per line)">
        <textarea
          className={inputClass}
          rows={6}
          required
          value={sections}
          onChange={(e) => setSections(e.target.value)}
          placeholder={"Chapters 1–3\nChapters 4–6\nChapters 7–9"}
        />
      </Field>
      <Field label="Punishment for the most clouds">
        <textarea
          className={inputClass}
          rows={2}
          required
          maxLength={2000}
          value={punishment}
          onChange={(e) => setPunishment(e.target.value)}
          placeholder="Karaoke. Full commitment."
        />
      </Field>
      <p className="text-xs text-ink/60">
        Sections rotate through members in join order, with two calendar days
        per turn. Saving this plan does not start the reading clock.
      </p>
      <Button
        type="submit"
        disabled={task.busy || !sections.trim() || !punishment.trim()}
      >
        Save sections & punishment
      </Button>
      <ErrorNote error={task.error} />
    </form>
  );
}

function Results({ poll }: { poll: Poll }) {
  if (!poll.tieBreakOrder.length && !poll.results.length) return null;
  const title = (id: Id<"nominations">) =>
    poll.nominations.find((n) => n._id === id)?.title ?? "Book";
  return (
    <Card>
      <details>
        <summary className="cursor-pointer font-semibold">
          {poll.results.length ? "Vote results & tie rules" : "Tie rules"}
        </summary>
        <p className="mt-3 text-sm text-ink/70">
          Ties for a finalist spot or ranked elimination use a random draw made
          before voting. Earlier books in the draw keep their place. A tied
          final gets a fresh vote.
        </p>
        {poll.tieBreakOrder.length > 0 && (
          <p className="mt-2 text-xs text-ink/60">
            Draw order: {poll.tieBreakOrder.map(title).join(" → ")}
          </p>
        )}
        {poll.results.map((result, i) => (
          <div className="mt-4 border-t border-ink/20 pt-3" key={i}>
            <h3 className="font-semibold">{result.label}</h3>
            <ul className="mt-1 text-sm">
              {result.counts.map((c) => (
                <li key={c.nominationId} className="flex justify-between gap-4">
                  <span>{title(c.nominationId)}</span>
                  <span>{c.votes}</span>
                </li>
              ))}
            </ul>
            {result.eliminatedNominationId && (
              <p className="mt-2 text-xs">
                Eliminated: {title(result.eliminatedNominationId)}
              </p>
            )}
            {result.exhaustedBallots > 0 && (
              <p className="text-xs">
                {result.exhaustedBallots} ballots have no remaining ranked
                choices.
              </p>
            )}
            {result.tieBreakUsed && (
              <p className="text-xs">The published draw broke a tie.</p>
            )}
          </div>
        ))}
      </details>
    </Card>
  );
}
