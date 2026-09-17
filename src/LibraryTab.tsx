import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { BookDetail } from "./BookTab";
import type { Home } from "./ClubView";
import { NextBookPoll } from "./VoteTab";
import { Button, Card, Pill } from "./ui";

/**
 * The Library: suggest + vote on the next book, and browse every book the
 * club has ever read — all the way back to the shelf's dusty end.
 */
export function LibraryTab(props: { clubId: Id<"clubs">; home: Home }) {
  const [openBookId, setOpenBookId] = useState<Id<"books"> | null>(null);

  if (openBookId !== null) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => setOpenBookId(null)}>
          ← Back to the library
        </Button>
        <BookDetail bookId={openBookId} viewerId={props.home.viewerId} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <NextBookPoll
        clubId={props.clubId}
        canParticipate={!props.home.viewerIsGhost}
      />
      <Shelf clubId={props.clubId} onOpen={setOpenBookId} />
    </div>
  );
}

function yearOf(day: string | null): string {
  return day ? day.slice(0, 4) : "";
}

function Shelf(props: {
  clubId: Id<"clubs">;
  onOpen: (id: Id<"books">) => void;
}) {
  const history = useQuery(api.books.history, { clubId: props.clubId });
  if (history === undefined) {
    return <p className="py-8 text-center text-muted">Dusting the shelves…</p>;
  }
  if (history.length === 0) {
    return (
      <Card>
        <h2 className="mb-1 text-lg font-bold">📚 The shelf</h2>
        <p className="text-sm text-muted">
          Nothing here yet — finish your first book and it takes its place in
          history.
        </p>
      </Card>
    );
  }

  // Newest first, numbered from the oldest so "book #1" is the club's first.
  const numbered = history.map((b, i) => ({
    ...b,
    number: history.length - i,
  }));

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold">📚 The shelf</h2>
        <Pill>{history.length} books</Pill>
      </div>
      <ul className="divide-y divide-ink/5">
        {numbered.map((b) => (
          <li key={b._id}>
            <button
              className="w-full rounded-lg px-2 py-4 text-left hover:bg-paper"
              onClick={() => props.onOpen(b._id)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    <span className="mr-1 text-muted">#{b.number}</span>
                    {b.title}
                    {b.author && (
                      <span className="font-normal text-muted">
                        {" "}
                        — {b.author}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-sm text-muted">
                    {yearOf(b.startedDay)}
                    {yearOf(b.endedDay) !== yearOf(b.startedDay) &&
                      `–${yearOf(b.endedDay)}`}
                    {b.status === "abandoned" && " · abandoned 🪦"}
                    {b.loserNames.length > 0 &&
                      ` · ☠️ ${b.loserNames.join(" & ")}: ${b.punishment}`}
                  </p>
                </div>
                <span aria-hidden="true" className="mt-1 shrink-0 text-xl text-muted">›</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
