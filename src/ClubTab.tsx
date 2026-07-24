import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { Home } from "./ClubView";
import { browserTimezone, errorMessage, timezoneOptions } from "./lib";
import { Button, Card, ErrorNote, Field, inputClass } from "./ui";

export function ClubTab(props: { clubId: Id<"clubs">; home: Home }) {
  return (
    <div className="space-y-4">
      <Members home={props.home} />
      <Invites clubId={props.clubId} />
      <Profile />
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
              {m.timezone ?? "timezone unknown"}
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
  const me = useQuery(api.users.me);
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
