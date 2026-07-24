import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { StartBookForm } from "./BookTab";
import { errorMessage } from "./lib";
import { Button, Card, ErrorNote, Field, Pill, inputClass } from "./ui";

export function VoteTab(props: { clubId: Id<"clubs"> }) {
  const poll = useQuery(api.polls.state, { clubId: props.clubId });
  const startPoll = useMutation(api.polls.start);
  const [error, setError] = useState<string | null>(null);

  if (poll === undefined) {
    return <p className="py-12 text-center text-ink/50">Counting ballots…</p>;
  }

  if (poll === null || (poll.status === "done" && poll.winnerNominationId === null)) {
    return (
      <Card>
        <h2 className="mb-1 text-lg font-bold">Pick the next book</h2>
        <p className="mb-3 text-sm text-ink/60">
          Everyone puts up two books (with a punishment attached), everyone
          votes for up to two — at most one of their own — and the top two go
          to a runoff.
        </p>
        <Button
          onClick={async () => {
            try {
              await startPoll({ clubId: props.clubId });
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        >
          🗳️ Open nominations
        </Button>
        <ErrorNote error={error} />
      </Card>
    );
  }

  switch (poll.status) {
    case "nominating":
      return <Nominating poll={poll} />;
    case "voting":
    case "runoff":
      return <Voting poll={poll} />;
    case "done":
      return <Done poll={poll} clubId={props.clubId} />;
  }
}

type Poll = NonNullable<FunctionReturnType<typeof api.polls.state>>;

function Nominating(props: { poll: Poll }) {
  const { poll } = props;
  const nominate = useMutation(api.polls.nominate);
  const withdraw = useMutation(api.polls.withdrawNomination);
  const close = useMutation(api.polls.closeNominations);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [punishment, setPunishment] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-bold">Nominations are open</h2>
          <Pill>{poll.nominations.length} so far</Pill>
        </div>
        <NominationList poll={poll} onWithdraw={(id) => void withdraw({ nominationId: id })} />
      </Card>

      {poll.myNominationCount < 2 && (
        <Card>
          <h2 className="mb-1 font-bold">
            Suggest a book ({poll.myNominationCount}/2 used)
          </h2>
          <p className="mb-3 text-sm text-ink/60">
            Name the stakes: if your book wins, the member with the most ⛈️ at
            the end owes this.
          </p>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              try {
                await nominate({
                  pollId: poll._id,
                  title,
                  author: author || undefined,
                  punishment,
                });
                setTitle("");
                setAuthor("");
                setPunishment("");
              } catch (err) {
                setError(errorMessage(err));
              }
            }}
          >
            <Field label="Title">
              <input
                className={inputClass}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </Field>
            <Field label="Author (optional)">
              <input
                className={inputClass}
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
              />
            </Field>
            <Field label="Punishment">
              <input
                className={inputClass}
                value={punishment}
                onChange={(e) => setPunishment(e.target.value)}
                placeholder="Buys everyone's next round"
                required
              />
            </Field>
            <ErrorNote error={error} />
            <Button type="submit">Nominate</Button>
          </form>
        </Card>
      )}

      <div className="text-center">
        <Button
          variant="ghost"
          onClick={async () => {
            setError(null);
            try {
              await close({ pollId: poll._id });
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        >
          Close nominations → start voting
        </Button>
      </div>
    </div>
  );
}

function NominationList(props: {
  poll: Poll;
  onWithdraw?: (id: Id<"nominations">) => void;
  selectable?: {
    selected: Id<"nominations">[];
    toggle: (id: Id<"nominations">) => void;
    eligible: (id: Id<"nominations">) => boolean;
  };
}) {
  const { poll, selectable } = props;
  const shown =
    poll.status === "runoff"
      ? poll.nominations.filter((n) => n.inRunoff)
      : poll.nominations;
  return (
    <ul className="space-y-2">
      {shown.map((n) => {
        const selected = selectable?.selected.includes(n._id) ?? false;
        return (
          <li
            key={n._id}
            className={`rounded-xl border p-3 ${
              n.isWinner
                ? "border-emerald-300 bg-emerald-50"
                : selected
                  ? "border-accent bg-accent/5"
                  : "border-ink/10"
            } ${selectable ? "cursor-pointer" : ""}`}
            onClick={
              selectable && selectable.eligible(n._id)
                ? () => selectable.toggle(n._id)
                : undefined
            }
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold">
                {n.title}
                {n.author && (
                  <span className="font-normal text-ink/50"> — {n.author}</span>
                )}
                {n.isWinner && " 🏆"}
              </p>
              {selectable ? (
                <span className="text-lg">{selected ? "☑️" : "⬜️"}</span>
              ) : (
                props.onWithdraw &&
                n.mine && (
                  <button
                    className="text-xs text-red-600 hover:underline"
                    onClick={() => props.onWithdraw!(n._id)}
                  >
                    withdraw
                  </button>
                )
              )}
            </div>
            <p className="text-sm text-ink/60">
              from {n.suggestedByName}
              {n.mine && " (you)"} · ☠️ {n.punishment}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function Voting(props: { poll: Poll }) {
  const { poll } = props;
  const isRunoff = poll.status === "runoff";
  const cast = useMutation(api.polls.castVote);
  const closeRound = useMutation(api.polls.closeRound);
  const [selected, setSelected] = useState<Id<"nominations">[]>(
    poll.myVote ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const maxPicks = isRunoff ? 1 : 2;

  const toggle = (id: Id<"nominations">) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (isRunoff) return [id];
      if (prev.length >= maxPicks) return prev;
      return [...prev, id];
    });
  };

  const ownSelected = selected.filter(
    (id) => poll.nominations.find((n) => n._id === id)?.mine,
  ).length;

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {isRunoff ? "🏁 Runoff — pick one" : "Cast your votes"}
          </h2>
          <Pill>
            {poll.votesCast}/{poll.memberCount} voted
          </Pill>
        </div>
        <p className="mb-3 text-sm text-ink/60">
          {isRunoff
            ? "Top finishers face off. One vote each; majority takes it."
            : "Pick up to two books — at most one of your own. The top two go to a runoff."}
        </p>
        <NominationList
          poll={poll}
          selectable={{
            selected,
            toggle,
            eligible: () => true,
          }}
        />
        {!isRunoff && ownSelected > 1 && (
          <p className="mt-2 text-sm font-medium text-amber-700">
            Only one of your own suggestions can get your vote.
          </p>
        )}
        <ErrorNote error={error} />
        <div className="mt-4 flex items-center gap-3">
          <Button
            disabled={selected.length === 0 || ownSelected > 1}
            onClick={async () => {
              setError(null);
              try {
                await cast({ pollId: poll._id, nominationIds: selected });
              } catch (err) {
                setError(errorMessage(err));
              }
            }}
          >
            {poll.myVote ? "Update ballot" : "Submit ballot"}
          </Button>
          {poll.myVote && <Pill tone="ok">ballot in ✅</Pill>}
        </div>
      </Card>
      <div className="text-center">
        <Button
          variant="ghost"
          onClick={async () => {
            setError(null);
            try {
              await closeRound({ pollId: poll._id });
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        >
          Everyone who's voting has voted — tally it
        </Button>
      </div>
    </div>
  );
}

function Done(props: { poll: Poll; clubId: Id<"clubs"> }) {
  const { poll } = props;
  const winner = poll.nominations.find((n) => n._id === poll.winnerNominationId);
  if (!winner) return null;
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-lg font-bold">🏆 The club has spoken</h2>
        <p className="mt-1">
          <span className="font-semibold">{winner.title}</span>
          {winner.author && ` by ${winner.author}`} — suggested by{" "}
          {winner.suggestedByName}.
        </p>
        <p className="mt-1 text-sm text-ink/60">☠️ Stakes: {winner.punishment}</p>
      </Card>
      {poll.clubIsReading ? (
        <Card>
          <p className="text-sm text-ink/60">
            📖 The club is reading — check the <strong>Book</strong> tab.
          </p>
        </Card>
      ) : (
        <StartBookForm
          clubId={props.clubId}
          poll={{
            pollId: poll._id,
            title: winner.title,
            author: winner.author,
          }}
        />
      )}
    </div>
  );
}
