import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { Home } from "./ClubView";
import {
  browserTimezone,
  errorMessage,
  prettyDay,
  timezoneOptions,
  useToday,
} from "./lib";
import { Button, Card, ErrorNote, Field, Pill, inputClass } from "./ui";

export function ClubTab(props: { clubId: Id<"clubs">; home: Home }) {
  return (
    <div className="space-y-4">
      <Members home={props.home} />
      <Invites clubId={props.clubId} />
      <Profile />
      <OffGrid />
      <SignOut />
    </div>
  );
}

function Members(props: { home: Home }) {
  return (
    <Card>
      <h2 className="mb-3 text-lg font-bold">Members</h2>
      <ul className="space-y-2 text-sm">
        {props.home.members.map((m) => (
          <li key={m._id} className="flex items-center justify-between">
            <span className="font-medium">
              {m.name}
              {m._id === props.home.viewerId && (
                <span className="text-ink/40"> (you)</span>
              )}
            </span>
            <span className="text-ink/50">
              {m.offGrid
                ? `⛈️ off the grid until ${prettyDay(m.offGrid.toDay)}`
                : (m.timezone ?? "timezone unknown")}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Invites(props: { clubId: Id<"clubs"> }) {
  const invites = useQuery(api.clubs.openInvites, { clubId: props.clubId });
  const createInvite = useMutation(api.clubs.createInvite);
  const [forName, setForName] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <h2 className="mb-1 text-lg font-bold">Invite someone</h2>
      <p className="mb-3 text-sm text-ink/60">
        Mint a single-use code and send it however you like. They enter it
        after signing up. Naming the invite pre-fills their display name and
        shows you who hasn't joined yet.
      </p>
      {invites && invites.length > 0 && (
        <ul className="mb-3 space-y-2">
          {invites.map((i) => (
            <li key={i._id} className="flex items-center justify-between rounded-xl bg-paper px-3 py-2">
              <span>
                <code className="font-mono text-lg tracking-widest">{i.code}</code>
                {i.forName && (
                  <span className="ml-2 text-sm text-ink/50">
                    for {i.forName}
                  </span>
                )}
              </span>
              <Button
                variant="ghost"
                onClick={async () => {
                  await navigator.clipboard.writeText(i.code);
                  setCopied(i.code);
                  setTimeout(() => setCopied(null), 1500);
                }}
              >
                {copied === i.code ? "Copied!" : "Copy"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await createInvite({
              clubId: props.clubId,
              forName: forName.trim() || undefined,
            });
            setForName("");
          } catch (err) {
            setError(errorMessage(err));
          }
        }}
      >
        <Field label="Who's it for? (optional)">
          <input
            className={inputClass}
            value={forName}
            onChange={(e) => setForName(e.target.value)}
            placeholder="e.g. Billy"
          />
        </Field>
        <Button type="submit">➕ New code</Button>
      </form>
      <ErrorNote error={error} />
    </Card>
  );
}

function Profile() {
  const me = useQuery(api.users.me, { viewerDay: useToday() });
  const update = useMutation(api.users.updateProfile);
  const [name, setName] = useState<string | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (me === undefined || me === null) return null;
  const nameValue = name ?? me.name;
  const tzValue = timezone ?? me.timezone ?? browserTimezone();

  return (
    <Card>
      <h2 className="mb-1 text-lg font-bold">You</h2>
      <p className="mb-3 text-sm text-ink/60">
        Your timezone decides when your day ends — for pushups and for section
        deadlines. Today for you: <strong>{me.today}</strong>.
      </p>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setSaved(false);
          try {
            await update({ name: nameValue, timezone: tzValue });
            setSaved(true);
          } catch (err) {
            setError(errorMessage(err));
          }
        }}
      >
        <Field label="Display name">
          <input
            className={inputClass}
            value={nameValue}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <Field label="Timezone">
          <select
            className={inputClass}
            value={tzValue}
            onChange={(e) => setTimezone(e.target.value)}
          >
            {timezoneOptions().map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </Field>
        <ErrorNote error={error} />
        <div className="flex items-center gap-3">
          <Button type="submit">Save</Button>
          {saved && <span className="text-sm text-emerald-700">Saved ✓</span>}
        </div>
      </form>
    </Card>
  );
}

type Absence = { fromDay: string; toDay: string; note: string };

/**
 * Declare, reschedule, and call off your own absences. Everything here is
 * personal — pushups are owed in every club — so it needs no clubId.
 */
function OffGrid() {
  const today = useToday();
  const periods = useQuery(api.offgrid.mine, { viewerDay: today });
  const declare = useMutation(api.offgrid.declare);
  const update = useMutation(api.offgrid.update);
  const cancel = useMutation(api.offgrid.cancel);
  const [editing, setEditing] = useState<Id<"offGridPeriods"> | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mutations reckon the day server-side, so a rejection is the club's rules
  // talking (overlaps, a start in the past) and belongs on screen verbatim.
  const attempt = async (run: () => Promise<unknown>) => {
    setError(null);
    try {
      await run();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  };

  return (
    <Card>
      <h2 className="mb-1 text-lg font-bold">Off the grid</h2>
      <p className="mb-3 text-sm text-ink/60">
        Heading somewhere without service? Say so before you go and each day
        away costs one ⛈️ instead of the 2 clouds silence costs — and if you
        find a bar of signal, a ⭐️ still beats it. Reading deadlines don't
        move.
      </p>

      {periods === undefined ? (
        <p className="text-sm text-ink/50">Checking your plans…</p>
      ) : periods.length === 0 ? (
        <p className="text-sm text-ink/50">Nothing planned.</p>
      ) : (
        <ul className="mb-3 space-y-2">
          {periods.map((p) =>
            editing === p._id ? (
              <li key={p._id} className="rounded-xl bg-paper px-3 py-3">
                <AbsenceForm
                  initial={{ fromDay: p.fromDay, toDay: p.toDay, note: p.note ?? "" }}
                  today={today}
                  // An absence under way has already been reckoned day by
                  // day; only its end is still in play.
                  lockStart={p.active}
                  submitLabel="Save"
                  onSubmit={async (values) => {
                    const ok = await attempt(() =>
                      update({
                        periodId: p._id,
                        fromDay: values.fromDay,
                        toDay: values.toDay,
                        note: values.note.trim() || null,
                      }),
                    );
                    if (ok) {
                      setEditing(null);
                    }
                  }}
                  onCancel={() => {
                    setEditing(null);
                    setError(null);
                  }}
                />
              </li>
            ) : (
              <li
                key={p._id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-paper px-3 py-2"
              >
                <span className="text-sm">
                  <strong>
                    {p.fromDay === p.toDay
                      ? prettyDay(p.fromDay)
                      : `${prettyDay(p.fromDay)} → ${prettyDay(p.toDay)}`}
                  </strong>
                  {p.active && (
                    <span className="ml-2">
                      <Pill tone="warn">Away now</Pill>
                    </span>
                  )}
                  {p.note && <span className="ml-2 text-ink/50">{p.note}</span>}
                </span>
                <span className="flex gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEditing(p._id);
                      setAdding(false);
                      setError(null);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => void attempt(() => cancel({ periodId: p._id }))}
                  >
                    {p.active ? "I'm back" : "Delete"}
                  </Button>
                </span>
              </li>
            ),
          )}
        </ul>
      )}

      {adding ? (
        <div className="rounded-xl bg-paper px-3 py-3">
          <AbsenceForm
            initial={{ fromDay: today, toDay: today, note: "" }}
            today={today}
            submitLabel="Declare"
            onSubmit={async (values) => {
              const ok = await attempt(() =>
                declare({
                  fromDay: values.fromDay,
                  toDay: values.toDay,
                  note: values.note.trim() || undefined,
                }),
              );
              if (ok) {
                setAdding(false);
              }
            }}
            onCancel={() => {
              setAdding(false);
              setError(null);
            }}
          />
        </div>
      ) : (
        editing === null && (
          <Button
            onClick={() => {
              setAdding(true);
              setError(null);
            }}
          >
            ➕ Declare an absence
          </Button>
        )
      )}
      <ErrorNote error={error} />
    </Card>
  );
}

function AbsenceForm(props: {
  initial: Absence;
  today: string;
  lockStart?: boolean;
  submitLabel: string;
  onSubmit: (values: Absence) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [fromDay, setFromDay] = useState(props.initial.fromDay);
  const [toDay, setToDay] = useState(props.initial.toDay);
  const [note, setNote] = useState(props.initial.note);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await props.onSubmit({ fromDay, toDay, note });
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex flex-wrap gap-3">
        <Field label="First day away">
          <input
            type="date"
            className={inputClass}
            value={fromDay}
            min={props.today}
            disabled={props.lockStart}
            onChange={(e) => {
              setFromDay(e.target.value);
              // A start dragged past the end takes the end with it.
              if (e.target.value > toDay) {
                setToDay(e.target.value);
              }
            }}
            required
          />
        </Field>
        <Field label="Last day away">
          <input
            type="date"
            className={inputClass}
            value={toDay}
            min={fromDay}
            onChange={(e) => setToDay(e.target.value)}
            required
          />
        </Field>
      </div>
      {props.lockStart && (
        <p className="text-xs text-ink/50">
          This one's under way — you can move the end, not the start.
        </p>
      )}
      <Field label="Note (optional)">
        <input
          className={inputClass}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. backpacking, no signal"
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : props.submitLabel}
        </Button>
        <Button variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function SignOut() {
  const { signOut } = useAuthActions();
  return (
    <p className="text-center">
      <button
        className="text-sm text-ink/50 hover:underline"
        onClick={() => void signOut()}
      >
        Sign out
      </button>
    </p>
  );
}
