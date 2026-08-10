import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import {
  currentUserId,
  hasActiveMembership,
  requireUser,
} from "./lib/access";
import {
  addDays,
  isPushupDay,
  readerDay,
  todayInTz,
  viewerDay,
} from "./lib/days";
import { notifyStarLogged } from "./notifications";

/**
 * How long a fresh report can still be taken back. Long enough to catch a
 * fat-fingered tap, short enough that the answer is still a commitment —
 * which is what makes the day's quote (quotes.ts) a reward for it.
 *
 * A couple of seconds longer than the ten the clients offer, so that an undo
 * tapped as the countdown hits zero isn't refused by its own round trip.
 */
export const UNDO_WINDOW_MS = 12_000;

/**
 * Report today's pushups: ⭐️ if you did them, ⛈️ if you didn't (1 cloud).
 * Only today — in your own timezone — can be reported, and the answer is
 * final once `UNDO_WINDOW_MS` has passed: no editing, no takebacks. Saying
 * nothing costs 2 clouds (applied by the nightly rollover in crons.ts).
 *
 * Later mistakes are an admin fix: `setup:backfillCheckin` replaces a day's
 * row and its clouds.
 */
export const submit = mutation({
  args: { status: v.union(v.literal("star"), v.literal("storm")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (!(await hasActiveMembership(ctx, user._id))) {
      throw new ConvexError("Ghosts owe no pushups — nothing to report.");
    }
    const today = todayInTz(user.timezone);
    if (!isPushupDay(today)) {
      throw new ConvexError("Sunday is a rest day — no pushups required.");
    }
    const existing = await ctx.db
      .query("checkins")
      .withIndex("userDay", (q) => q.eq("userId", user._id).eq("day", today))
      .unique();
    if (existing !== null) {
      throw new ConvexError(
        existing.status === "missed"
          ? "That day already rolled over."
          : "You already reported today — that one's locked in.",
      );
    }

    // Nothing to reconcile: no check-in for the day means no self-reported
    // cloud for it either. `undo` removes both together.
    if (args.status === "storm") {
      await ctx.db.insert("clouds", {
        userId: user._id,
        day: today,
        count: 1,
        source: "pushups_storm",
      });
    }
    await ctx.db.insert("checkins", {
      userId: user._id,
      day: today,
      status: args.status,
    });
    // Hold the announcement until the report can no longer be taken back —
    // most of the club has star pushes on, and "Henry: ⭐️" landing on five
    // phones a second before Henry undoes a mis-tap is worse than a slightly
    // late star.
    if (args.status === "star") {
      await ctx.scheduler.runAfter(
        UNDO_WINDOW_MS,
        internal.pushups.announceStar,
        { userId: user._id, day: today },
      );
    }
    return null;
  },
});

/** Take back a report made moments ago — see `UNDO_WINDOW_MS`. */
export const undo = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const today = todayInTz(user.timezone);
    const existing = await ctx.db
      .query("checkins")
      .withIndex("userDay", (q) => q.eq("userId", user._id).eq("day", today))
      .unique();
    if (existing === null) {
      throw new ConvexError("Nothing to take back — you haven't reported.");
    }
    // A "missed" row is the rollover's verdict, not something they typed.
    if (existing.status === "missed") {
      throw new ConvexError("That day already rolled over.");
    }
    if (Date.now() - existing._creationTime > UNDO_WINDOW_MS) {
      throw new ConvexError("Too late — that one's locked in.");
    }
    // The only `pushups_storm` cloud this day can hold is the one `submit`
    // just wrote: the rollover writes its own alongside a check-in, and this
    // check-in is seconds old.
    const cloud = await ctx.db
      .query("clouds")
      .withIndex("userDay", (q) => q.eq("userId", user._id).eq("day", today))
      // eslint-disable-next-line @convex-dev/no-filter-in-query -- narrows one user-day (a handful of rows) by source; a source index would be overkill
      .filter((q) => q.eq(q.field("source"), "pushups_storm"))
      .unique();
    if (cloud !== null) {
      await ctx.db.delete("clouds", cloud._id);
    }
    await ctx.db.delete("checkins", existing._id);
    return null;
  },
});

/**
 * Announce a ⭐️ once its undo window has closed — scheduled by `submit`, so
 * it has to re-read the day and check the star is still standing.
 */
export const announceStar = internalMutation({
  args: { userId: v.id("users"), day: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const checkin = await ctx.db
      .query("checkins")
      .withIndex("userDay", (q) =>
        q.eq("userId", args.userId).eq("day", args.day),
      )
      .unique();
    if (checkin === null || checkin.status !== "star") {
      return null; // taken back inside the window
    }
    const user = await ctx.db.get("users", args.userId);
    if (user !== null) {
      await notifyStarLogged(ctx, user);
    }
    return null;
  },
});

/** The viewer's last two weeks of check-ins, most recent day first. */
export const history = query({
  // The fourteen-day window it reports slides at the reader's midnight.
  args: { viewerDay },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    if (userId === null) {
      return [];
    }
    const user = await ctx.db.get("users", userId);
    if (user === null) {
      return [];
    }
    const today = readerDay(args.viewerDay, user.timezone);
    const fromDay = addDays(today, -13);
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- indexed to a bounded day window
    const checkins = await ctx.db
      .query("checkins")
      .withIndex("userDay", (q) =>
        q.eq("userId", userId).gte("day", fromDay).lte("day", today),
      )
      .collect();
    const byDay = new Map(checkins.map((c) => [c.day, c.status]));
    const result = [];
    for (let day = today; day >= fromDay; day = addDays(day, -1)) {
      result.push({
        day,
        required: isPushupDay(day),
        status: byDay.get(day) ?? null,
      });
    }
    return result;
  },
});
