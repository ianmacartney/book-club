import { useMutation, useQueries, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import {
  ReactNode,
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Alert, AppState } from "react-native";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type {
  BookDetail,
  DailyQuote,
  CheckinStatus,
  FeedEvent,
  Home,
  Invite,
  Me,
  NotificationSettings,
  OffGridPeriod,
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

/** The device's calendar day as yyyy-MM-dd, without leaning on Intl. */
function localDay(): string {
  const d = new Date();
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * The reader's local day, re-rendering when it changes. Queries that reckon
 * "today" pass this so they re-run at midnight instead of serving a result
 * cached yesterday (see `viewerDay` in convex/lib/days.ts) — without it, a
 * ⭐️ logged at 00:01 writes to a day the cached query never read, and the
 * screen doesn't budge.
 */
export function useToday(): string {
  const [day, setDay] = useState(localDay);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setDay(localDay());
      const now = new Date();
      // A hair past midnight, so a timer firing early can't land on the same
      // day and spin.
      const next = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0,
        0,
        2,
      );
      clearTimeout(timer);
      timer = setTimeout(tick, next.getTime() - now.getTime());
    };
    tick();
    // Timers don't fire dependably while the app is backgrounded, which is
    // how a phone usually crosses midnight — so re-check on the way back in.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        tick();
      }
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, []);
  return day;
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
  return useQuery(api.clubs.home, { clubId, viewerDay: useToday() });
}

export function useMe(): Me | null | undefined {
  return useQuery(api.users.me, { viewerDay: useToday() });
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
  const viewerDay = useToday();
  const detail = useQuery(
    api.books.detail,
    targetId !== null
      ? { bookId: targetId as Id<"books">, viewerDay }
      : "skip",
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

/** undefined = loading; null = nothing minted for today. */
export function useDailyQuote(): DailyQuote | null | undefined {
  const clubId = useClubId();
  return useQuery(api.quotes.today, { clubId, viewerDay: useToday() });
}

export function useSettings(): NotificationSettings | undefined {
  return useQuery(api.notifications.mySettings);
}

/** The viewer's own current and upcoming absences, soonest first. */
export function useMyAbsences(): OffGridPeriod[] | undefined {
  return useQuery(api.offgrid.mine, { viewerDay: useToday() });
}

/**
 * The feed pages backwards through calendar-day windows: the newest window
 * is a live subscription; "load older" pins additional windows by their
 * `through` cursor (also live, but their contents are historical). Windows
 * are concatenated oldest→newest, matching the backend's in-window order.
 *
 * The live window knows nothing about "today" — it runs open-ended off the
 * end of the data, so anything newly written is already inside it. The one
 * thing it needs from us is its floor, pinned the moment we page below it so
 * that a day can't slip into the gap between the two.
 */
type FeedWindow = {
  events: FeedEvent[];
  hasMore: boolean;
  nextThrough: string;
  window: { from: string; through: string | null };
};

export function useFeed(): {
  events: FeedEvent[] | undefined;
  hasMore: boolean;
  loadingOlder: boolean;
  loadOlder: () => void;
} {
  const clubId = useClubId();
  const [cursors, setCursors] = useState<string[]>([]);
  const [liveFrom, setLiveFrom] = useState<string | null>(null);

  const queries = useMemo(() => {
    const q: Record<
      string,
      {
        query: typeof api.feed.forClub;
        args: { clubId: Id<"clubs">; through?: string; from?: string };
      }
    > = {
      w0: {
        query: api.feed.forClub,
        args: liveFrom === null ? { clubId } : { clubId, from: liveFrom },
      },
    };
    cursors.forEach((through, i) => {
      q[`w${i + 1}`] = { query: api.feed.forClub, args: { clubId, through } };
    });
    return q;
  }, [clubId, cursors, liveFrom]);

  const results = useQueries(queries);
  const held = useRef<{ events: FeedEvent[]; hasMore: boolean } | null>(null);

  return useMemo(() => {
    // Collect loaded windows newest→oldest, stopping at the first one still
    // in flight. Only ever the just-pinned OLDEST window can be loading, so
    // everything already on screen keeps rendering — `events` must never
    // revert to undefined mid-scroll, or the list unmounts and an inverted
    // FlatList remounts at the bottom.
    const windows: FeedWindow[] = [];
    let loadingOlder = false;
    for (let i = 0; i <= cursors.length; i++) {
      const w = results[`w${i}`];
      if (w === undefined || w instanceof Error) {
        if (i === 0) {
          // Initial load — or the live window re-keying as its floor is
          // pinned. Keep showing the last good result through the gap: going
          // back to undefined unmounts the list and springs it to the bottom.
          return {
            events: held.current?.events,
            hasMore: held.current?.hasMore ?? false,
            loadingOlder: false,
            loadOlder: () => {},
          };
        }
        loadingOlder = true;
        break;
      }
      windows.push(w as FeedWindow);
    }
    const oldest = windows[windows.length - 1];
    // Oldest window's events first, newest last.
    const events = windows
      .slice()
      .reverse()
      .flatMap((w) => w.events);
    const hasMore = oldest.hasMore;
    held.current = { events, hasMore };
    return {
      events,
      hasMore,
      loadingOlder,
      // One window in flight at a time; onEndReached can fire repeatedly.
      loadOlder: loadingOlder
        ? () => {}
        : () => {
            // Freeze the live window's floor on the way down. Until now it
            // was free to move as the club's newest day advanced; from here
            // on, something is pinned directly beneath it.
            if (liveFrom === null) {
              setLiveFrom(windows[0].window.from);
            }
            const next = oldest.nextThrough;
            setCursors((prev) =>
              prev.includes(next) ? prev : [...prev, next],
            );
          },
    };
  }, [results, cursors, liveFrom]);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function useActions(): {
  checkIn: (status: "star" | "storm") => Promise<boolean>;
  undoCheckIn: () => Promise<void>;
  submitSection: (sectionId: string, quotes: string, thoughts: string) => void;
  // Bank a write-up for a section that hasn't come up yet. Resolves to what
  // actually happened: "submitted" when the book had already reached it.
  saveDraft: (
    sectionId: string,
    quotes: string,
    thoughts: string,
  ) => Promise<"saved" | "submitted" | null>;
  discardDraft: (sectionId: string) => Promise<void>;
  postReply: (sectionId: string, body: string) => Promise<boolean>;
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
  reactToQuote: (quoteId: string, reaction: "up" | "down" | null) => void;
  declareAbsence: (args: {
    fromDay: string;
    toDay: string;
    note?: string;
  }) => Promise<boolean>;
  updateAbsence: (args: {
    periodId: string;
    fromDay?: string;
    toDay?: string;
    note?: string | null;
  }) => Promise<boolean>;
  cancelAbsence: (periodId: string) => Promise<boolean>;
} {
  const checkIn = useMutation(api.pushups.submit);
  const undoCheckIn = useMutation(api.pushups.undo);
  const submitSection = useMutation(api.books.submitSection);
  const saveDraft = useMutation(api.books.saveDraft);
  const discardDraft = useMutation(api.books.discardDraft);
  const postReply = useMutation(api.replies.post);
  const updateSettings = useMutation(api.notifications.updateSettings);
  const registerPushToken = useMutation(api.notifications.registerPushToken);
  const updateProfile = useMutation(api.users.updateProfile);
  const createInvite = useMutation(api.clubs.createInvite);
  const submitFeedback = useMutation(api.feedback.submit);
  const reactToQuote = useMutation(api.quotes.react);
  const declareAbsence = useMutation(api.offgrid.declare);
  const updateAbsence = useMutation(api.offgrid.update);
  const cancelAbsence = useMutation(api.offgrid.cancel);
  const clubId = useClubId();
  return {
    // Reports success so the caller can start its undo countdown from the
    // moment the report actually landed.
    checkIn: async (status) => {
      try {
        await checkIn({ status });
        return true;
      } catch (err) {
        alertError(err);
        return false;
      }
    },
    undoCheckIn: async () => {
      await undoCheckIn().catch(alertError);
    },
    submitSection: (sectionId, quotes, thoughts) => {
      submitSection({
        sectionId: sectionId as Id<"sections">,
        quotes,
        thoughts,
      }).catch(alertError);
    },
    saveDraft: async (sectionId, quotes, thoughts) => {
      try {
        return await saveDraft({
          sectionId: sectionId as Id<"sections">,
          quotes,
          thoughts,
        });
      } catch (err) {
        alertError(err);
        return null;
      }
    },
    discardDraft: async (sectionId) => {
      await discardDraft({ sectionId: sectionId as Id<"sections"> }).catch(
        alertError,
      );
    },
    // Reports success so the composer can hand a rejected draft back to the
    // writer instead of swallowing it.
    postReply: async (sectionId, body) => {
      try {
        await postReply({ sectionId: sectionId as Id<"sections">, body });
        return true;
      } catch (err) {
        alertError(err);
        return false;
      }
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
    reactToQuote: (quoteId, reaction) => {
      reactToQuote({ quoteId: quoteId as Id<"quotes">, reaction }).catch(
        alertError,
      );
    },
    // The three absence writes report success so the editor can stay open on
    // a rejection — the club's rules (overlaps, a start in the past) come
    // back as messages worth reading, not states worth guessing at.
    declareAbsence: async (args) => {
      try {
        await declareAbsence(args);
        return true;
      } catch (err) {
        alertError(err);
        return false;
      }
    },
    updateAbsence: async ({ periodId, ...rest }) => {
      try {
        await updateAbsence({
          periodId: periodId as Id<"offGridPeriods">,
          ...rest,
        });
        return true;
      } catch (err) {
        alertError(err);
        return false;
      }
    },
    cancelAbsence: async (periodId) => {
      try {
        await cancelAbsence({ periodId: periodId as Id<"offGridPeriods"> });
        return true;
      } catch (err) {
        alertError(err);
        return false;
      }
    },
  };
}
