import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { BookTab } from "./BookTab";
import { ClubTab } from "./ClubTab";
import { LibraryTab } from "./LibraryTab";
import { StandingsTab } from "./StandingsTab";
import { errorMessage, prettyDay, useToday } from "./lib";
import { Button, Card, ErrorNote, NavIcon, Pill, inputClass } from "./ui";

type Tab = "today" | "book" | "library" | "standings" | "club";

const TABS: { id: Tab; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "book", label: "Book" },
  { id: "library", label: "Library" },
  { id: "standings", label: "Clouds" },
  { id: "club", label: "Club" },
];

export function ClubView(props: {
  clubId: Id<"clubs">;
  clubs: { _id: Id<"clubs">; name: string }[];
  onSwitchClub: (id: Id<"clubs">) => void;
}) {
  const home = useQuery(api.clubs.home, {
    clubId: props.clubId,
    viewerDay: useToday(),
  });
  const [tab, setTab] = useState<Tab>("today");

  if (home === undefined) {
    return <p className="py-24 text-center text-muted">Opening the club…</p>;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <h1 className="min-w-0 text-2xl font-bold sm:text-3xl">
          <span aria-hidden="true">📚 </span>
          {home.club.name}
        </h1>
        {props.clubs.length > 1 && (
          <select
            aria-label="Switch club"
            className={`${inputClass} sm:max-w-56 sm:shrink-0`}
            value={props.clubId}
            onChange={(e) => props.onSwitchClub(e.target.value as Id<"clubs">)}
          >
            {props.clubs.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </header>

      <nav
        aria-label="Club navigation"
        className="grid grid-cols-5 gap-1 rounded-2xl border border-line bg-white p-1.5"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => setTab(t.id)}
            className={`flex min-h-15 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-xs font-semibold sm:min-h-12 sm:flex-row sm:gap-2 sm:text-sm ${
              tab === t.id ? "bg-accent text-white" : "text-muted hover:bg-paper hover:text-ink"
            }`}
          >
            <NavIcon name={t.id} />
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "today" && <TodayTab home={home} />}
      {tab === "book" && (
        <BookTab
          clubId={props.clubId}
          home={home}
          onChooseBook={() => setTab("library")}
        />
      )}
      {tab === "library" && <LibraryTab clubId={props.clubId} home={home} />}
      {tab === "standings" && (
        <StandingsTab clubId={props.clubId} home={home} />
      )}
      {tab === "club" && <ClubTab clubId={props.clubId} home={home} />}
    </div>
  );
}

export type Home = FunctionReturnType<typeof api.clubs.home>;

/** Seconds a fresh report can be taken back; the backend allows a couple
 * more so an undo tapped on zero isn't refused by its own round trip. */
const UNDO_SECONDS = 10;

function TodayTab(props: { home: Home }) {
  const { home } = props;
  const submit = useMutation(api.pushups.submit);
  const undo = useMutation(api.pushups.undo);
  const history = useQuery(api.pushups.history, { viewerDay: useToday() });
  const [error, setError] = useState<string | null>(null);
  // Only counts down in the session that reported — coming back tomorrow
  // shouldn't offer to undo a settled day. See UNDO_WINDOW_MS on the backend.
  const [undoLeft, setUndoLeft] = useState<number | null>(null);
  const viewer = home.members.find((m) => m._id === home.viewerId);

  useEffect(() => {
    if (undoLeft === null) return;
    if (undoLeft <= 0) {
      setUndoLeft(null);
      return;
    }
    const timer = setTimeout(() => setUndoLeft(undoLeft - 1), 1000);
    return () => clearTimeout(timer);
  }, [undoLeft]);

  const report = async (status: "star" | "storm") => {
    setError(null);
    try {
      await submit({ status });
      setUndoLeft(UNDO_SECONDS);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const takeBack = async () => {
    setError(null);
    try {
      await undo();
    } catch (err) {
      setError(errorMessage(err));
    }
    setUndoLeft(null);
  };

  return (
    <div className="grid items-start gap-5 md:grid-cols-2">
      <Card className="md:col-span-2">
        <h2 className="mb-2 text-2xl font-bold">
          {home.activeBookId === null ? "Between books" : "Did you do your pushups?"}
        </h2>
        <p className="mb-6 text-sm text-muted">
          {home.activeBookId === null
            ? "Push-ups are paused until the next book starts. Visit the Library to help choose it."
            : `${viewer ? prettyDay(viewer.today) : ""} — report before your midnight. Silence costs ⛈️⛈️.`}
        </p>
        {viewer && !viewer.isPushupDay ? (
          <Pill tone="ok">{home.activeBookId === null ? "No push-ups required" : "Sunday — rest day 😴"}</Pill>
        ) : (
          // Reported is reported: the answer can't be revised, so the buttons
          // go away rather than sitting there erroring.
          viewer?.checkinToday == null && (
            <div className="flex gap-3">
              <Button
                onClick={() => void report("star")}
                variant="ghost"
                className="checkin-choice hover:border-accent hover:bg-accent/10"
              >
                <span aria-hidden="true" className="text-3xl">
                  ⭐️
                </span>
                Did them
              </Button>
              <Button
                onClick={() => void report("storm")}
                variant="ghost"
                className="checkin-choice hover:border-accent hover:bg-accent/10"
              >
                <span aria-hidden="true" className="text-3xl">
                  ⛈️
                </span>
                Didn't
              </Button>
            </div>
          )
        )}
        {viewer?.checkinToday && (
          <p className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted">
            <span role="status">
              {viewer.checkinToday === "missed"
                ? "Your day rolled over without a word — ⛈️⛈️."
                : `Logged ${viewer.checkinToday === "star" ? "⭐️" : "⛈️"} for today.`}
            </span>
            {undoLeft !== null && (
              <button
                onClick={() => void takeBack()}
                className="min-h-11 px-2 font-bold tabular-nums text-accent"
              >
                Undo · {undoLeft}s
              </button>
            )}
          </p>
        )}
        <ErrorNote error={error} />
      </Card>

      <Card className={!history?.length ? "md:col-span-2" : ""}>
        <h2 className="mb-3 text-lg font-bold">The club today</h2>
        <ul className="divide-y divide-line">
          {home.members.map((m) => (
            <li key={m._id} className="flex items-center justify-between gap-3 py-3">
              <span className="min-w-0 font-medium">
                {m.name}
                {m._id === home.viewerId && (
                  <span className="text-muted"> (you)</span>
                )}
              </span>
              <span
                role="img"
                aria-label={
                  !m.isPushupDay
                    ? "Rest day"
                    : m.checkinToday === "star"
                      ? "Pushups done"
                      : m.checkinToday === "storm"
                        ? "Pushups not done"
                        : m.checkinToday === "missed"
                          ? "Missed check-in"
                          : "No check-in yet"
                }
                className="shrink-0 text-xl"
              >
                {!m.isPushupDay
                  ? "😴"
                  : m.checkinToday === "star"
                    ? "⭐️"
                    : m.checkinToday === "storm"
                      ? "⛈️"
                      : m.checkinToday === "missed"
                        ? "⛈️⛈️"
                        : "⏳"}
              </span>
            </li>
          ))}
        </ul>
        {home.activeBookId !== null && (
          <p className="mt-3 text-xs text-muted">
            ⏳ = no word yet (their local day may still be young)
          </p>
        )}
      </Card>

      {history && history.length > 0 && (
        <Card>
          <h2 className="mb-3 text-lg font-bold">Your last two weeks</h2>
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
            {[...history].reverse().map((d) => (
              <div
                key={d.day}
                role="img"
                aria-label={`${prettyDay(d.day)}: ${!d.required ? "rest day" : d.status === "star" ? "pushups done" : d.status === "storm" ? "pushups not done" : d.status === "missed" ? "missed check-in" : "no check-in"}`}
                title={`${prettyDay(d.day)}`}
                className="flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-lg bg-paper text-sm"
              >
                <span>
                  {!d.required
                    ? "😴"
                    : d.status === "star"
                      ? "⭐️"
                      : d.status === "storm"
                        ? "⛈️"
                        : d.status === "missed"
                          ? "⛈️⛈️"
                          : "·"}
                </span>
                <span className="text-xs tabular-nums text-muted">
                  {d.day.slice(8)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
