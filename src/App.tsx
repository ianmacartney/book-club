import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
} from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { AuthScreen } from "./AuthScreen";
import { ClubView } from "./ClubView";
import { Onboarding } from "./Onboarding";
import { browserTimezone } from "./lib";

export function App() {
  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 py-6">
      <AuthLoading>
        <p className="py-24 text-center text-ink/50">Opening the club…</p>
      </AuthLoading>
      <Unauthenticated>
        <AuthScreen />
      </Unauthenticated>
      <Authenticated>
        <SignedIn />
      </Authenticated>
    </div>
  );
}

function SignedIn() {
  const me = useQuery(api.users.me);
  const clubs = useQuery(api.clubs.mine);
  const ensureTimezone = useMutation(api.users.ensureTimezone);
  const [clubId, setClubId] = useState<Id<"clubs"> | null>(
    () => (localStorage.getItem("clubId") as Id<"clubs"> | null) ?? null,
  );

  // Deadlines live and die by the member's timezone; capture it right away.
  useEffect(() => {
    if (me && me.timezone === null) {
      void ensureTimezone({ timezone: browserTimezone() });
    }
  }, [me, ensureTimezone]);

  if (me === undefined || clubs === undefined) {
    return <p className="py-24 text-center text-ink/50">Opening the club…</p>;
  }
  if (me === null) {
    return null; // auth state settling
  }

  const selected =
    clubs.find((c) => c._id === clubId) ?? (clubs.length > 0 ? clubs[0] : null);
  if (selected === null) {
    return <Onboarding onJoined={(id) => selectClub(id, setClubId)} />;
  }

  return (
    <ClubView
      key={selected._id}
      clubId={selected._id}
      clubs={clubs}
      onSwitchClub={(id) => selectClub(id, setClubId)}
    />
  );
}

function selectClub(
  id: Id<"clubs">,
  set: (id: Id<"clubs"> | null) => void,
) {
  localStorage.setItem("clubId", id);
  set(id);
}
