import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { QueryCtx, query } from "./_generated/server";
import { clubRecipientIds, requireMembership } from "./lib/access";
import { addDays, todayInTz } from "./lib/days";

/**
 * The club's life as a chat-style timeline, composed on the fly from the
 * tables that already record it: check-ins (⭐️/⛈️), section submissions
 * (quotes + thoughts inline), book starts/finishes, and Sunday summaries.
 *
 * Nothing is denormalized, so all 8 years of imported history is already in
 * the feed. When general messages/discussions arrive, they become one more
 * event source merged in here.
 *
 * Paging is by calendar-day windows: each call returns every event in
 * [from, through] plus `nextThrough` to request the older window.
 */

const DEFAULT_WINDOW_DAYS = 14;
const MAX_WINDOW_DAYS = 60;

export type FeedEvent =
  | {
      type: "checkin";
      day: string;
      at: number;
      userId: Id<"users">;
      name: string;
      status: "star" | "storm" | "missed";
    }
  | {
      type: "submission";
      day: string;
      at: number;
      userId: Id<"users">; // who wrote it
      name: string;
      bookId: Id<"books">;
      bookTitle: string;
      sectionIndex: number;
      sectionTitle: string;
      assigneeName: string;
      skip: boolean;
      quotes: string;
      thoughts: string;
      isLastSection: boolean;
    }
  | {
      type: "bookStarted";
      day: string;
      at: number;
      bookId: Id<"books">;
      bookTitle: string;
      author: string | null;
      suggestedByName: string | null;
      punishment: string;
    }
  | {
      type: "bookEnded";
      day: string;
      at: number;
      bookId: Id<"books">;
      bookTitle: string;
      status: "finished" | "abandoned";
      punishment: string;
      loserNames: string[];
    }
  | {
      type: "weekSummary";
      day: string;
      at: number;
      entries: { name: string; weekClouds: number; bookClouds: number }[];
    };

async function nameOf(
  ctx: QueryCtx,
  cache: Map<Id<"users">, string>,
  userId: Id<"users">,
): Promise<string> {
  const hit = cache.get(userId);
  if (hit !== undefined) {
    return hit;
  }
  const user = await ctx.db.get(userId);
  const name = user?.name ?? user?.username ?? "former member";
  cache.set(userId, name);
  return name;
}

export const forClub = query({
  args: {
    clubId: v.id("clubs"),
    // Newest day (inclusive) of the window; omit for "now". Pass the
    // previous response's `nextThrough` to page older.
    through: v.optional(v.string()),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireMembership(ctx, args.clubId);
    const windowDays = Math.min(
      Math.max(Math.floor(args.days ?? DEFAULT_WINDOW_DAYS), 1),
      MAX_WINDOW_DAYS,
    );
    // Members east of the viewer can already be on "tomorrow".
    const through = args.through ?? addDays(todayInTz(viewer.timezone), 1);
    const from = addDays(through, -(windowDays - 1));

    const names = new Map<Id<"users">, string>();
    const events: FeedEvent[] = [];

    // --- Check-ins: one indexed range scan per member ----------------------
    // Ghosts included: an ex-member's historical check-ins stay in the feed.
    const memberIds = await clubRecipientIds(ctx, args.clubId);
    for (const memberId of memberIds) {
      const checkins = await ctx.db
        .query("checkins")
        .withIndex("userDay", (q) =>
          q.eq("userId", memberId).gte("day", from).lte("day", through),
        )
        .collect();
      for (const c of checkins) {
        events.push({
          type: "checkin",
          day: c.day,
          at: c._creationTime,
          userId: memberId,
          name: await nameOf(ctx, names, memberId),
          status: c.status,
        });
      }
    }

    // --- Books: starts, ends, and submissions in the window ----------------
    // A club accrues a few dozen books over the years; scanning them is cheap
    // and only books overlapping the window pay for a sections read.
    const books: Doc<"books">[] = [];
    for (const status of ["active", "finished", "abandoned"] as const) {
      books.push(
        ...(await ctx.db
          .query("books")
          .withIndex("clubStatus", (q) =>
            q.eq("clubId", args.clubId).eq("status", status),
          )
          .collect()),
      );
    }
    for (const book of books) {
      if (book.startedDay >= from && book.startedDay <= through) {
        events.push({
          type: "bookStarted",
          day: book.startedDay,
          at: book._creationTime,
          bookId: book._id,
          bookTitle: book.title,
          author: book.author ?? null,
          suggestedByName: book.suggestedBy
            ? await nameOf(ctx, names, book.suggestedBy)
            : null,
          punishment: book.punishment,
        });
      }
      const ended = book.endedDay;
      if (
        book.status !== "active" &&
        ended !== undefined &&
        ended >= from &&
        ended <= through
      ) {
        events.push({
          type: "bookEnded",
          day: ended,
          at: book._creationTime,
          bookId: book._id,
          bookTitle: book.title,
          status: book.status,
          punishment: book.punishment,
          loserNames: await Promise.all(
            (book.result?.loserIds ?? []).map((id) =>
              nameOf(ctx, names, id),
            ),
          ),
        });
      }
      // Skip the sections read when the book can't have submissions inside
      // the window.
      if (
        book.startedDay > through ||
        (ended !== undefined && ended < from)
      ) {
        continue;
      }
      const sections = await ctx.db
        .query("sections")
        .withIndex("bookIdx", (q) => q.eq("bookId", book._id))
        .collect();
      const lastIndex = Math.max(...sections.map((s) => s.index));
      for (const s of sections) {
        const sub = s.submission;
        if (sub === undefined || sub.day < from || sub.day > through) {
          continue;
        }
        events.push({
          type: "submission",
          day: sub.day,
          at: sub.at,
          userId: sub.by,
          name: await nameOf(ctx, names, sub.by),
          bookId: book._id,
          bookTitle: book.title,
          sectionIndex: s.index,
          sectionTitle: s.title,
          assigneeName: await nameOf(ctx, names, s.assignedTo),
          skip: sub.skip,
          quotes: sub.quotes,
          thoughts: sub.thoughts,
          isLastSection: s.index === lastIndex,
        });
      }
    }

    // --- Sunday summaries ---------------------------------------------------
    const summaries = await ctx.db
      .query("summaries")
      .withIndex("clubWeek", (q) =>
        q
          .eq("clubId", args.clubId)
          .gte("weekEndingDay", from)
          .lte("weekEndingDay", through),
      )
      .collect();
    for (const s of summaries) {
      events.push({
        type: "weekSummary",
        day: s.weekEndingDay,
        at: s._creationTime,
        entries: await Promise.all(
          s.entries.map(async (e) => ({
            name: await nameOf(ctx, names, e.userId),
            weekClouds: e.weekClouds,
            bookClouds: e.bookClouds,
          })),
        ),
      });
    }

    // Oldest first; a chat list renders bottom-anchored. Within a day,
    // creation order is right for live data (imports share a timestamp, so
    // they fall back to a stable name sort).
    events.sort(
      (a, b) =>
        a.day.localeCompare(b.day) ||
        a.at - b.at ||
        ("name" in a && "name" in b ? a.name.localeCompare(b.name) : 0),
    );

    const oldestBookDay = books.reduce<string | null>(
      (oldest, b) =>
        oldest === null || b.startedDay < oldest ? b.startedDay : oldest,
      null,
    );
    return {
      events,
      viewerId: viewer._id,
      window: { from, through },
      nextThrough: addDays(from, -1),
      // History runs out once the window predates the club's first book.
      hasMore: oldestBookDay !== null && from > oldestBookDay,
    };
  },
});
