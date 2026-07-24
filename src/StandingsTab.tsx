import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { Home } from "./ClubView";
import { prettyDay } from "./lib";
import { Card, Pill } from "./ui";

export function StandingsTab(props: { clubId: Id<"clubs">; home: Home }) {
  const { home } = props;
  const summaries = useQuery(api.summaries.forClub, { clubId: props.clubId });
  const standings = [...home.members].sort(
    (a, b) => b.bookClouds - a.bookClouds,
  );

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-1 text-lg font-bold">⛈️ Current standings</h2>
        <p className="mb-3 text-sm text-ink/60">
          {home.activeBookId
            ? "Clouds gathered since the current book began. Most clouds when the last section lands owes the punishment."
            : "No book underway — clouds start counting when one begins."}
        </p>
        <ul className="space-y-2">
          {standings.map((m, i) => (
            <li
              key={m._id}
              className="flex items-center justify-between rounded-xl bg-paper px-3 py-2"
            >
              <span className="font-medium">
                {i === 0 && m.bookClouds > 0 ? "☠️ " : ""}
                {m.name}
                {m._id === home.viewerId && (
                  <span className="text-ink/40"> (you)</span>
                )}
              </span>
              <span className="font-semibold">
                {m.bookClouds} ⛈️
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-bold">📬 Sunday summaries</h2>
        {summaries === undefined ? (
          <p className="text-sm text-ink/50">Loading…</p>
        ) : summaries.length === 0 ? (
          <p className="text-sm text-ink/60">
            Every Sunday the week's stormy clouds get tallied up here.
          </p>
        ) : (
          <div className="space-y-4">
            {summaries.map((s) => (
              <div key={s._id}>
                <div className="mb-1 flex items-center gap-2">
                  <h3 className="font-semibold">
                    Week ending {prettyDay(s.weekEndingDay)}
                  </h3>
                  <Pill>{s.entries.reduce((n, e) => n + e.weekClouds, 0)} ⛈️ total</Pill>
                </div>
                <ul className="space-y-1 text-sm">
                  {s.entries.map((e) => (
                    <li key={e.userId} className="flex justify-between">
                      <span>{e.name}</span>
                      <span>
                        {e.weekClouds} ⛈️ this week
                        {e.bookClouds > 0 && (
                          <span className="text-ink/50">
                            {" "}
                            · {e.bookClouds} this book
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
