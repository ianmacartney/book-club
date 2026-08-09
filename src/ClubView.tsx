import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { BookTab } from "./BookTab";
import { ClubTab } from "./ClubTab";
import { LibraryTab } from "./LibraryTab";
import { StandingsTab } from "./StandingsTab";
import { errorMessage, prettyDay, useToday } from "./lib";
import { Button, Card, ErrorNote, Pill } from "./ui";

type Tab = "today" | "book" | "library" | "standings" | "club";

const TABS: { id: Tab; label: string }[] = [
  { id: "today", label: "⭐️ Today" },
  { id: "book", label: "📖 Book" },
  { id: "library", label: "🏛️ Library" },
  { id: "standings", label: "⛈️ Clouds" },
  { id: "club", label: "👥 Club" },
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
    return <p className="py-24 text-center text-ink/50">Opening the club…</p>;
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">📚 {home.club.name}</h1>
        {props.clubs.length > 1 && (
          <select
            className="rounded-xl border border-ink/20 bg-white px-2 py-1 text-sm"
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

      <nav className="flex gap-1 overflow-x-auto rounded-2xl border border-ink/10 bg-white p-1 shadow-sm">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition ${
              tab === t.id ? "bg-accent text-white" : "hover:bg-ink/5"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "today" && <TodayTab home={home} />}
      {tab === "book" && <BookTab clubId={props.clubId} home={home} />}
      {tab === "library" && <LibraryTab clubId={props.clubId} home={home} />}
      {tab === "standings" && (
        <StandingsTab clubId={props.clubId} home={home} />
      )}
      {tab === "club" && <ClubTab clubId={props.clubId} home={home} />}
    </div>
  );
}

export type Home = FunctionReturnType<typeof api.clubs.home>;

function TodayTab(props: { home: Home }) {
  const { home } = props;
  const submit = useMutation(api.pushups.submit);
  const history = useQuery(api.pushups.history, { viewerDay: useToday() });
  const [error, setError] = useState<string | null>(null);
  const viewer = home.members.find((m) => m._id === home.viewerId);

  const report = async (status: "star" | "storm") => {
    setError(null);
    try {
      await submit({ status });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-1 text-lg font-bold">Did you do your pushups?</h2>
        <p className="mb-4 text-sm text-ink/60">
          {viewer ? prettyDay(viewer.today) : ""} — report before your midnight.
          Silence costs ⛈️⛈️.
        </p>
        {viewer && !viewer.isPushupDay ? (
          <Pill tone="ok">Sunday — rest day 😴</Pill>
        ) : (
          // Reported is reported: the answer can't be revised, so the buttons
          // go away rather than sitting there erroring.
          viewer?.checkinToday == null && (
            <div className="flex gap-3">
              <Button
                onClick={() => void report("star")}
                variant="ghost"
                className="flex-1 py-4 text-2xl"
              >
                ⭐️ Did them
              </Button>
              <Button
                onClick={() => void report("storm")}
                variant="ghost"
                className="flex-1 py-4 text-2xl"
              >
                ⛈️ Didn't
              </Button>
            </div>
          )
        )}
        {viewer?.checkinToday && (
          <p className="mt-3 text-sm text-ink/60">
            {viewer.checkinToday === "missed"
              ? "Your day rolled over without a word — ⛈️⛈️."
              : `Logged ${viewer.checkinToday === "star" ? "⭐️" : "⛈️"} for today — that one's final.`}
          </p>
        )}
        <ErrorNote error={error} />
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-bold">The club today</h2>
        <ul className="space-y-2">
          {home.members.map((m) => (
            <li key={m._id} className="flex items-center justify-between">
              <span className="font-medium">
                {m.name}
                {m._id === home.viewerId && (
                  <span className="text-ink/40"> (you)</span>
                )}
              </span>
              <span className="text-lg">
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
        <p className="mt-3 text-xs text-ink/40">
          ⏳ = no word yet (their local day may still be young)
        </p>
      </Card>

      {history && history.length > 0 && (
        <Card>
          <h2 className="mb-3 text-lg font-bold">Your last two weeks</h2>
          <div className="flex flex-wrap gap-2">
            {[...history].reverse().map((d) => (
              <div
                key={d.day}
                title={`${prettyDay(d.day)}`}
                className="flex h-12 w-9 flex-col items-center justify-center rounded-lg border border-ink/10 bg-paper text-xs"
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
                <span className="text-[10px] text-ink/40">
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
