import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { Home } from "./ClubView";
import { errorMessage, prettyDay, useToday } from "./lib";
import { Button, Card, ErrorNote, Field, Pill, inputClass } from "./ui";

export function BookTab(props: { clubId: Id<"clubs">; home: Home }) {
  if (props.home.activeBookId !== null) {
    return (
      <BookDetail bookId={props.home.activeBookId} viewerId={props.home.viewerId} />
    );
  }
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-1 text-lg font-bold">No book on the go</h2>
        <p className="text-sm text-ink/60">
          Head to the <strong>🏛️ Library</strong> tab to pick the next book
          together — or start one directly below if the club already agreed.
        </p>
      </Card>
      <StartBookForm clubId={props.clubId} />
    </div>
  );
}

export function BookDetail(props: { bookId: Id<"books">; viewerId: Id<"users"> }) {
  const detail = useQuery(api.books.detail, {
    bookId: props.bookId,
    viewerDay: useToday(),
  });
  const abandon = useMutation(api.books.abandon);
  const [error, setError] = useState<string | null>(null);

  if (detail === undefined) {
    return <p className="py-12 text-center text-ink/50">Fetching the book…</p>;
  }
  const { book, sections, current } = detail;
  const done = sections.filter((s) => s.submission !== null).length;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">{book.title}</h2>
            {book.author && <p className="text-ink/60">by {book.author}</p>}
          </div>
          <Pill tone={book.status === "active" ? "ok" : "muted"}>
            {done}/{sections.length} sections
          </Pill>
        </div>
        <p className="mt-3 text-sm">
          <span className="font-semibold">☠️ Stakes</span>
          {book.suggestedBy ? ` (set by ${book.suggestedBy})` : ""}:{" "}
          {book.punishment}
        </p>
        {book.result && (
          <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm">
            <p className="font-bold">The book is finished!</p>
            {book.result.loserIds.length > 0 ? (
              <p>
                Most stormy clouds:{" "}
                {detail.standings
                  .filter((s) =>
                    book.result!.loserIds.includes(s.userId),
                  )
                  .map((s) => `${s.name} (${s.clouds} ⛈️)`)
                  .join(", ")}{" "}
                — the punishment is owed. ☠️
              </p>
            ) : (
              <p>A spotless book — nobody owes the punishment. 🎉</p>
            )}
          </div>
        )}
      </Card>

      <div className="space-y-3">
        {sections.map((s) => {
          const isCurrent = current?.sectionId === s._id;
          return (
            <Card
              key={s._id}
              className={isCurrent ? "border-accent ring-2 ring-accent/20" : ""}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-bold">
                  {s.index + 1}. {s.title}
                </h3>
                {s.submission ? (
                  <Pill tone="ok">
                    {s.submission.skip ? "skipped ⛈️⛈️" : "done ✅"}
                  </Pill>
                ) : isCurrent ? (
                  <Pill tone={current!.daysLate > 0 ? "warn" : "muted"}>
                    {current!.daysLate > 0
                      ? `${current!.daysLate} day${current!.daysLate === 1 ? "" : "s"} late — ${current!.daysLate * 2} ⛈️ and counting`
                      : s.dueDay
                        ? `due ${prettyDay(s.dueDay)}`
                        : "up now"}
                  </Pill>
                ) : s.draft ? (
                  <Pill tone="ok">written ahead ✍️</Pill>
                ) : (
                  <Pill>upcoming</Pill>
                )}
              </div>
              <p className="mt-1 text-sm text-ink/60">
                {s.assigneeName}'s turn
                {s.dueDay && !s.submission && ` · due ${prettyDay(s.dueDay)}`}
              </p>
              {s.submission && <Submission submission={s.submission} />}
              {isCurrent && (
                <SectionForm
                  section={s}
                  current={current!}
                  viewerId={props.viewerId}
                />
              )}
              {!isCurrent && !s.submission && (
                <DraftForm section={s} viewerId={props.viewerId} />
              )}
            </Card>
          );
        })}
      </div>

      {book.status === "active" && (
        <div className="text-center">
          <Button
            variant="danger"
            onClick={async () => {
              if (!confirm("Abandon this book for the whole club?")) return;
              try {
                await abandon({ bookId: book._id });
              } catch (err) {
                setError(errorMessage(err));
              }
            }}
          >
            Abandon book
          </Button>
          <ErrorNote error={error} />
        </div>
      )}
    </div>
  );
}

function Submission(props: {
  submission: {
    byName: string;
    day: string;
    quotes: string;
    thoughts: string;
    skip: boolean;
    draftedAt?: number;
  };
}) {
  const [open, setOpen] = useState(false);
  const s = props.submission;
  return (
    <div className="mt-2">
      <button
        className="text-sm font-semibold text-accent hover:underline"
        onClick={() => setOpen(!open)}
      >
        {open ? "Hide" : "Read"} {s.byName}'s notes ({prettyDay(s.day)})
        {s.skip && " — covered for the assignee"}
        {s.draftedAt !== undefined && " — written ahead"}
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-xl bg-paper p-3 text-sm">
          {s.quotes && (
            <div>
              <p className="font-semibold">Quotes</p>
              <p className="whitespace-pre-wrap italic">{s.quotes}</p>
            </div>
          )}
          {s.thoughts && (
            <div>
              <p className="font-semibold">Thoughts</p>
              <p className="whitespace-pre-wrap">{s.thoughts}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SectionForm(props: {
  section: { _id: Id<"sections">; assignedTo: Id<"users">; assigneeName: string };
  current: { daysLate: number; skipperId: Id<"users"> };
  viewerId: Id<"users">;
}) {
  const submit = useMutation(api.books.submitSection);
  const [quotes, setQuotes] = useState("");
  const [thoughts, setThoughts] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mine = props.section.assignedTo === props.viewerId;
  const canSkip =
    !mine && props.current.daysLate > 0 && props.current.skipperId === props.viewerId;
  if (!mine && !canSkip) {
    return null;
  }

  return (
    <form
      className="mt-3 space-y-3 border-t border-ink/10 pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await submit({ sectionId: props.section._id, quotes, thoughts });
        } catch (err) {
          setError(errorMessage(err));
        }
      }}
    >
      {canSkip && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm">
          {props.section.assigneeName} is overdue. You can submit this section
          for them — they'll take ⛈️⛈️ extra for the skip.
        </p>
      )}
      <Field label="Quotes">
        <textarea
          className={inputClass}
          rows={3}
          value={quotes}
          onChange={(e) => setQuotes(e.target.value)}
          placeholder="Lines worth keeping…"
        />
      </Field>
      <Field label="Thoughts">
        <textarea
          className={inputClass}
          rows={4}
          value={thoughts}
          onChange={(e) => setThoughts(e.target.value)}
          placeholder="What did you make of it?"
          required
        />
      </Field>
      <ErrorNote error={error} />
      <Button type="submit">
        {mine ? "Submit my section" : "Submit for them (skip)"}
      </Button>
    </form>
  );
}

/**
 * Bank a write-up for one of your own sections before its turn comes round.
 * Nothing posts now — the draft sits on the section and releases itself the
 * moment the book reaches it, whether you're at your phone or not.
 */
function DraftForm(props: {
  section: {
    _id: Id<"sections">;
    title: string;
    assignedTo: Id<"users">;
    draft: { at: number; mine: boolean; quotes: string | null; thoughts: string | null } | null;
  };
  viewerId: Id<"users">;
}) {
  const saveDraft = useMutation(api.books.saveDraft);
  const discardDraft = useMutation(api.books.discardDraft);
  const draft = props.section.draft;
  const [open, setOpen] = useState(false);
  const [quotes, setQuotes] = useState(draft?.quotes ?? "");
  const [thoughts, setThoughts] = useState(draft?.thoughts ?? "");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  if (props.section.assignedTo !== props.viewerId) {
    // Someone else's turn ahead. Whether they've written it is on the pill;
    // the words themselves keep until it posts.
    return null;
  }

  if (!open) {
    return (
      <div className="mt-2">
        <button
          className="text-sm font-semibold text-accent hover:underline"
          onClick={() => {
            setQuotes(draft?.quotes ?? "");
            setThoughts(draft?.thoughts ?? "");
            setNote(null);
            setOpen(true);
          }}
        >
          {draft ? "Edit your banked write-up ✍️" : "Write it ahead of time ✍️"}
        </button>
        {note && <p className="mt-1 text-sm text-emerald-700">{note}</p>}
      </div>
    );
  }

  return (
    <form
      className="mt-3 space-y-3 border-t border-ink/10 pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          const result = await saveDraft({
            sectionId: props.section._id,
            quotes,
            thoughts,
          });
          setOpen(false);
          setNote(
            result === "submitted"
              ? "You were up already — it posted to the club."
              : "Banked. It posts the moment your turn comes round.",
          );
        } catch (err) {
          setError(errorMessage(err));
        }
      }}
    >
      <p className="rounded-xl bg-paper p-3 text-sm text-ink/70">
        Nothing goes out now. When “{props.section.title}” comes up in the
        rotation this posts itself, on time, without you.
      </p>
      <Field label="Quotes">
        <textarea
          className={inputClass}
          rows={3}
          value={quotes}
          onChange={(e) => setQuotes(e.target.value)}
          placeholder="Lines worth keeping…"
        />
      </Field>
      <Field label="Thoughts">
        <textarea
          className={inputClass}
          rows={4}
          value={thoughts}
          onChange={(e) => setThoughts(e.target.value)}
          placeholder="What did you make of it?"
        />
      </Field>
      <ErrorNote error={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit">{draft ? "Update draft" : "Bank it"}</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        {draft && (
          <Button
            variant="danger"
            onClick={async () => {
              if (!confirm("Throw away the write-up you'd banked?")) return;
              setError(null);
              try {
                await discardDraft({ sectionId: props.section._id });
                setQuotes("");
                setThoughts("");
                setOpen(false);
                setNote(null);
              } catch (err) {
                setError(errorMessage(err));
              }
            }}
          >
            Discard
          </Button>
        )}
      </div>
    </form>
  );
}

export function StartBookForm(props: {
  clubId: Id<"clubs">;
  poll?: {
    pollId: Id<"polls">;
    title: string;
    author: string | null;
  };
}) {
  const startDirect = useMutation(api.books.start);
  const startFromPoll = useMutation(api.polls.startWinningBook);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [punishment, setPunishment] = useState("");
  const [sectionsText, setSectionsText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fromPoll = props.poll !== undefined;

  return (
    <Card>
      <h2 className="mb-1 text-lg font-bold">
        {fromPoll
          ? `Start reading “${props.poll!.title}”`
          : "Start a book directly"}
      </h2>
      <p className="mb-3 text-sm text-ink/60">
        Split the book into sections — one per line. Sections rotate through
        the members in join order; each turn is 2 calendar days.
      </p>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          const sectionTitles = sectionsText
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l.length > 0);
          try {
            if (fromPoll) {
              await startFromPoll({ pollId: props.poll!.pollId, sectionTitles });
            } else {
              await startDirect({
                clubId: props.clubId,
                title,
                author: author || undefined,
                punishment,
                sectionTitles,
              });
            }
          } catch (err) {
            setError(errorMessage(err));
          }
        }}
      >
        {!fromPoll && (
          <>
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
            <Field label="Punishment for the loser">
              <input
                className={inputClass}
                value={punishment}
                onChange={(e) => setPunishment(e.target.value)}
                placeholder="Karaoke. Full commitment."
                required
              />
            </Field>
          </>
        )}
        <Field label="Sections (one per line)">
          <textarea
            className={inputClass}
            rows={6}
            value={sectionsText}
            onChange={(e) => setSectionsText(e.target.value)}
            placeholder={"Chapters 1–3\nChapters 4–6\nChapters 7–9"}
            required
          />
        </Field>
        <ErrorNote error={error} />
        <Button type="submit">📖 Start the book</Button>
      </form>
    </Card>
  );
}

