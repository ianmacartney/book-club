import { useMutation, useQueries, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import {
  ReactNode,
  createContext,
  createElement,
  useContext,
  useMemo,
  useState,
} from "react";
import { Alert } from "react-native";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type {
  BookDetail,
  CheckinStatus,
  FeedEvent,
  Home,
  Invite,
  Me,
  NotificationSettings,
  ShelfBook,
} from "./types";

/**
 * The app's data layer: thin hooks over the shared Convex API. Screens
 * consume the wire shapes in ./types (the generated return types satisfy
 * them structurally — ids relax to strings on this side).
 */

const ClubContext = createContext<Id<"clubs"> | undefined>(undefined);

export function ClubProvider(props: {
  clubId: Id<"clubs">;
  children: ReactNode;
}) {
  return createElement(
    ClubContext.Provider,
    { value: props.clubId },
    props.children,
  );
}

function useClubId(): Id<"clubs"> {
  const clubId = useContext(ClubContext);
  if (clubId === undefined) {
    throw new Error("Data hooks must be used inside <ClubProvider>.");
  }
  return clubId;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ConvexError && typeof err.data === "string") {
    return err.data;
  }
  return err instanceof Error ? err.message : String(err);
}

function alertError(err: unknown): void {
  Alert.alert("Hm.", errorMessage(err));
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useHome(): Home | undefined {
  const clubId = useClubId();
  return useQuery(api.clubs.home, { clubId });
}

export function useMe(): Me | null | undefined {
  return useQuery(api.users.me);
}

/**
 * Book detail for the Book tab and the Library's per-book view. Pass a
 * `bookId` to browse a specific (usually finished) book; omit it to follow
 * the club's active book. undefined = still loading; null = no active book.
 */
export function useBook(bookId?: string): BookDetail | null | undefined {
  const home = useHome();
  const activeBookId = home?.activeBookId ?? null;
  const targetId = bookId ?? activeBookId;
  const detail = useQuery(
    api.books.detail,
    targetId !== null ? { bookId: targetId as Id<"books"> } : "skip",
  );
  // Browsing a specific book: home is irrelevant, just reflect the query.
  if (bookId !== undefined) {
    return detail;
  }
  // Following the active book: mirror the home load / no-active states.
  if (home === undefined) {
    return undefined;
  }
  return activeBookId === null ? null : detail;
}

export function useShelf(): ShelfBook[] | undefined {
  const clubId = useClubId();
  return useQuery(api.books.history, { clubId });
}

export function useInvites(): Invite[] | undefined {
  const clubId = useClubId();
  return useQuery(api.clubs.openInvites, { clubId });
}

export function useSettings(): NotificationSettings | undefined {
  return useQuery(api.notifications.mySettings);
}

/**
 * The feed pages backwards through calendar-day windows: the newest window
 * is a live subscription; "load older" pins additional windows by their
 * `through` cursor (also live, but their contents are historical). Windows
 * are concatenated oldest→newest, matching the backend's in-window order.
 */
export function useFeed(): {
  events: FeedEvent[] | undefined;
  hasMore: boolean;
  loadingOlder: boolean;
  loadOlder: () => void;
} {
  const clubId = useClubId();
  const [cursors, setCursors] = useState<string[]>([]);

  const queries = useMemo(() => {
    const q: Record<
      string,
      { query: typeof api.feed.forClub; args: { clubId: Id<"clubs">; through?: string } }
    > = { w0: { query: api.feed.forClub, args: { clubId } } };
    cursors.forEach((through, i) => {
      q[`w${i + 1}`] = { query: api.feed.forClub, args: { clubId, through } };
    });
    return q;
  }, [clubId, cursors]);

  const results = useQueries(queries);

  return useMemo(() => {
    // Collect loaded windows newest→oldest, stopping at the first one still
    // in flight. Only ever the just-pinned OLDEST window can be loading, so
    // everything already on screen keeps rendering — `events` must never
    // revert to undefined mid-scroll, or the list unmounts and an inverted
    // FlatList remounts at the bottom.
    const windows = [];
    let loadingOlder = false;
    for (let i = 0; i <= cursors.length; i++) {
      const w = results[`w${i}`];
      if (w === undefined || w instanceof Error) {
        if (i === 0) {
          // Nothing loaded yet: the true initial-load state.
          return {
            events: undefined,
            hasMore: false,
            loadingOlder: false,
            loadOlder: () => {},
          };
        }
        loadingOlder = true;
        break;
      }
      windows.push(w);
    }
    const oldest = windows[windows.length - 1];
    return {
      // Oldest window's events first, newest last.
      events: windows
        .slice()
        .reverse()
        .flatMap((w) => w.events as FeedEvent[]),
      hasMore: oldest.hasMore as boolean,
      loadingOlder,
      // One window in flight at a time; onEndReached can fire repeatedly.
      loadOlder: loadingOlder
        ? () => {}
        : () => {
            const next = oldest.nextThrough as string;
            setCursors((prev) =>
              prev.includes(next) ? prev : [...prev, next],
            );
          },
    };
  }, [results, cursors]);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function useActions(): {
  checkIn: (status: "star" | "storm") => void;
  submitSection: (sectionId: string, quotes: string, thoughts: string) => void;
  updateSettings: (patch: {
    reminderTime?: string | null;
    notifyOnStars?: boolean;
    notifyOnSubmissions?: boolean;
  }) => void;
  registerPushToken: (token: string) => Promise<void>;
  updateProfile: (args: {
    name?: string;
    timezone?: string;
  }) => Promise<boolean>;
  createInvite: (forName?: string) => Promise<string | null>;
  submitFeedback: (message: string) => Promise<boolean>;
} {
  const checkIn = useMutation(api.pushups.submit);
  const submitSection = useMutation(api.books.submitSection);
  const updateSettings = useMutation(api.notifications.updateSettings);
  const registerPushToken = useMutation(api.notifications.registerPushToken);
  const updateProfile = useMutation(api.users.updateProfile);
  const createInvite = useMutation(api.clubs.createInvite);
  const submitFeedback = useMutation(api.feedback.submit);
  const clubId = useClubId();
  return {
    checkIn: (status) => {
      checkIn({ status }).catch(alertError);
    },
    submitSection: (sectionId, quotes, thoughts) => {
      submitSection({
        sectionId: sectionId as Id<"sections">,
        quotes,
        thoughts,
      }).catch(alertError);
    },
    updateSettings: (patch) => {
      updateSettings(patch).catch(alertError);
    },
    registerPushToken: async (token) => {
      await registerPushToken({ token }).catch(alertError);
    },
    updateProfile: async (args) => {
      try {
        await updateProfile(args);
        return true;
      } catch (err) {
        alertError(err);
        return false;
      }
    },
    createInvite: async (forName) => {
      try {
        return await createInvite({ clubId, forName });
      } catch (err) {
        alertError(err);
        return null;
      }
    },
    submitFeedback: async (message) => {
      try {
        await submitFeedback({ message, clubId });
        return true;
      } catch (err) {
        alertError(err);
        return false;
      }
    },
  };
}
