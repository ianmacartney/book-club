import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { errorMessage } from "./lib";
import { Button, Card, ErrorNote, Field, inputClass } from "./ui";

/** Clubs are invite-only: create your own, or enter a code from a member. */
export function Onboarding(props: { onJoined: (id: Id<"clubs">) => void }) {
  const { signOut } = useAuthActions();
  const createClub = useMutation(api.clubs.create);
  const joinWithCode = useMutation(api.clubs.joinWithCode);
  const [clubName, setClubName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-md space-y-4 pt-16">
      <h1 className="text-center text-2xl font-bold">Welcome 👋</h1>
      <p className="text-center text-ink/60">
        Book clubs are invite-only. Redeem an invite code, or found a club of
        your own.
      </p>
      <Card>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              props.onJoined(await joinWithCode({ code }));
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        >
          <h2 className="font-bold">Join with an invite code</h2>
          <Field label="Invite code">
            <input
              className={inputClass}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. QK7RPX2M"
              required
            />
          </Field>
          <Button type="submit">Join club</Button>
        </form>
      </Card>
      <Card>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              props.onJoined(await createClub({ name: clubName }));
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        >
          <h2 className="font-bold">Found a new club</h2>
          <Field label="Club name">
            <input
              className={inputClass}
              value={clubName}
              onChange={(e) => setClubName(e.target.value)}
              placeholder="The 6am Chapter & Pushup Society"
              required
            />
          </Field>
          <Button type="submit">Create club</Button>
        </form>
      </Card>
      <ErrorNote error={error} />
      <p className="text-center">
        <button
          className="text-sm text-ink/50 hover:underline"
          onClick={() => void signOut()}
        >
          Sign out
        </button>
      </p>
    </div>
  );
}
