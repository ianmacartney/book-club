import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { QueryCtx, query } from "./_generated/server";
import { clubRecipientIds, requireMembership } from "./lib/access";
import { addDays } from "./lib/days";

/**
 * The club's life as a chat-style timeline, composed on the fly from the
 * tables that already record it: check-ins (⭐️/⛈️), section submissions
 * (quotes + thoughts inline), book starts/finishes, and Sunday summaries.
 *
 * Nothing is denormalized, so all 8 years of imported history is already in
 * the feed. Replies to a write-up are the one thing members type straight
 * into the timeline; unattached chat would become one more source merged in
 * here.
 *
 * Paging is by calendar-day windows, anchored on the data rather than on the
 * clock. The live window has a floor and no ceiling, so a newer entry appears
 * by *being* newer — there is no "today" to go stale, and no cached result
 * that a midnight can invalidate. Every event carries the `day` it belongs
 * to; naming that day "today" or "yesterday" is the client's job, since the
 * client is the one holding a live clock.
 *
 * Older pages are closed windows: each returns every event in [from, through]
 * plus `nextThrough` to request the one below it.
 */

const DEFAULT_WINDOW_DAYS = 14;
const MAX_WINDOW_DAYS = 60;

/**
 * The live window has no upper edge. Day strings compare lexicographically,
 * so a sentinel past every real day keeps the four range scans uniform while
 * meaning "and everything after".
 */
const OPEN_ENDED = "9999-12-31";

/**
 * The newest day the club has anything on, for placing the live window's
 * floor on first load. Deliberately cheap: one descending index probe per
 * source, and no section reads (submissions have no day index — the day
 * lives inside `sections.submission`).
 *
 * It's allowed to be a day or two behind because it only sets how far *back*
 * the first window reaches, which is cosmetic. Nothing can be missed off the
 * top: the live window is open-ended, so anything newer is in range whatever
 * this returns.
 */
async function newestDayWithData(
  ctx: QueryCtx,
  clubId: Id<"clubs">,
  memberIds: Id<"users">[],
  books: Doc<"books">[],
): Promise<string | null> {
  let newest: string | null = null;
  const consider = (day: string | undefined) => {
    if (day !== undefined && (newest === null || day > newest)) {
      newest = day;
    }
  };
  for (const memberId of memberIds) {
    const latest = await ctx.db
      .query("checkins")
      .withIndex("userDay", (q) => q.eq("userId", memberId))
      .order("desc")
      .first();
    consider(latest?.day);
  }
  consider(
    (
      await ctx.db
        .query("replies")
        .withIndex("clubDay", (q) => q.eq("clubId", clubId))
        .order("desc")
        .first()
    )?.day,
  );
  consider(
    (
      await ctx.db
        .query("summaries")
        .withIndex("clubWeek", (q) => q.eq("clubId", clubId))
        .order("desc")
        .first()
    )?.weekEndingDay,
  );
  for (const book of books) {
    consider(book.startedDay);
    consider(book.endedDay);
  }
  return newest;
}

export type FeedReply = {
  replyId: Id<"replies">;
  day: string;
  at: number;
  userId: Id<"users">;
  name: string;
  body: string;
};

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
      sectionId: Id<"sections">; // what a reply threads onto
      sectionIndex: number;
      sectionTitle: string;
      assigneeName: string;
      skip: boolean;
      quotes: string;
      thoughts: string;
      isLastSection: boolean;
      replies: FeedReply[];
    }
  | {
      // A reply whose write-up sits outside this window — it stands on its
      // own day, naming what it answers.
      type: "reply";
      day: string;
      at: number;
      replyId: Id<"replies">;
      userId: Id<"users">;
      name: string;
      body: string;
      sectionId: Id<"sections">;
      sectionTitle: string;
      bookTitle: string;
      writerName: string;
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
  const user = await ctx.db.get("users", userId);
  const name = user?.name ?? user?.username ?? "former member";
  cache.set(userId, name);
  return name;
}

export const forClub = query({
  args: {
    clubId: v.id("clubs"),
    // A historical page: the newest day it covers. Omit for the live window,
    // which runs open-ended off the end. Pass the previous response's
    // `nextThrough` to page older.
    through: v.optional(v.string()),
    // Pins the live window's oldest day. The client sends back the `from` it
    // was given the moment it pages older, so the live window can only grow
    // upward from there — if its floor slid forward instead, the day it
    // vacated would fall into a hole between it and the pinned page below.
    from: v.optional(v.string()),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireMembership(ctx, args.clubId);
    const windowDays = Math.min(
      Math.max(Math.floor(args.days ?? DEFAULT_WINDOW_DAYS), 1),
      MAX_WINDOW_DAYS,
    );

    // Ghosts included: an ex-member's historical check-ins stay in the feed.
    const memberIds = await clubRecipientIds(ctx, args.clubId);
    // A club accrues a few dozen books over the years; scanning them is cheap
    // and only books overlapping the window pay for a sections read.
    const books: Doc<"books">[] = [];
    for (const status of ["active", "finished", "abandoned"] as const) {
      books.push(
        // eslint-disable-next-line @convex-dev/no-collect-in-query -- a club's books — bounded (<1000)
        ...(await ctx.db
          .query("books")
          .withIndex("clubStatus", (q) =>
            q.eq("clubId", args.clubId).eq("status", status),
          )
          .collect()),
      );
    }

    // The window is anchored on the data, never on the clock — a newer entry
    // shows up by *being* newer, and the client decides what to call each day
    // from the `day` every event carries. The live window therefore runs
    // open-ended: anything written after this query last ran is inside it.
    const through = args.through ?? OPEN_ENDED;
    const anchor =
      args.through ??
      (await newestDayWithData(ctx, args.clubId, memberIds, books)) ??
      // A club with nothing in it: any floor yields an empty window.
      books.reduce<string>(
        (oldest, b) => (b.startedDay < oldest ? b.startedDay : oldest),
        "1970-01-01",
      );
    const from = args.from ?? addDays(anchor, -(windowDays - 1));

    const names = new Map<Id<"users">, string>();
    const events: FeedEvent[] = [];

    // --- Check-ins: one indexed range scan per member ----------------------
    for (const memberId of memberIds) {
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- indexed from the window floor; the live window grows a row per member per day
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

    // --- Replies, grouped by the write-up they answer ----------------------
    // A reply belongs to the window holding its own day, like everything
    // else: nested under its write-up when that lands in the same window,
    // standalone (naming the write-up) when the talk outlived it. Either
    // way it appears exactly once across the windows.
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- indexed from the window floor; the live window grows a row per member per day
    const replyRows = await ctx.db
      .query("replies")
      .withIndex("clubDay", (q) =>
        q.eq("clubId", args.clubId).gte("day", from).lte("day", through),
      )
      .collect();
    const threads = new Map<Id<"sections">, FeedReply[]>();
    for (const r of replyRows) {
      const thread = threads.get(r.sectionId) ?? [];
      thread.push({
        replyId: r._id,
        day: r.day,
        at: r._creationTime,
        userId: r.userId,
        name: await nameOf(ctx, names, r.userId),
        body: r.body,
      });
      threads.set(r.sectionId, thread);
    }
    for (const thread of threads.values()) {
      thread.sort((a, b) => a.at - b.at);
    }

    // --- Books: starts, ends, and submissions in the window ----------------
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
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- one book's sections — bounded (<1000/book, dozens in practice)
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
          sectionId: s._id,
          sectionIndex: s.index,
          sectionTitle: s.title,
          assigneeName: await nameOf(ctx, names, s.assignedTo),
          skip: sub.skip,
          quotes: sub.quotes,
          thoughts: sub.thoughts,
          isLastSection: s.index === lastIndex,
          // Claimed by the write-up; whatever's left over stands alone below.
          replies: threads.get(s._id) ?? [],
        });
        threads.delete(s._id);
      }
    }

    // --- Replies whose write-up isn't in this window ------------------------
    for (const [sectionId, thread] of threads) {
      const section = await ctx.db.get("sections", sectionId);
      const sub = section?.submission;
      const book =
        section === null ? null : await ctx.db.get("books", section.bookId);
      if (section === null || sub === undefined || book === null) {
        continue;
      }
      const writerName = await nameOf(ctx, names, sub.by);
      for (const reply of thread) {
        events.push({
          type: "reply",
          ...reply,
          sectionId,
          sectionTitle: section.title,
          bookTitle: book.title,
          writerName,
        });
      }
    }

    // --- Sunday summaries ---------------------------------------------------
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- indexed to a bounded week window
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
      // `through: null` = the live window, open-ended off the end. Send `from`
      // back as this query's `from` when you page older, to pin it.
      window: { from, through: args.through ?? null },
      nextThrough: addDays(from, -1),
      // History runs out once the window predates the club's first book.
      hasMore: oldestBookDay !== null && from > oldestBookDay,
    };
  },
});
