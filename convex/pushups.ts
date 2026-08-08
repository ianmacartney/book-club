import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
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
 * Report today's pushups: ⭐️ if you did them, ⛈️ if you didn't (1 cloud).
 * Only today — in your own timezone — can be reported, and you can change
 * your answer until your day rolls over. Saying nothing costs 2 clouds
 * (applied by the nightly rollover in crons.ts).
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
    if (existing !== null && existing.status === "missed") {
      throw new ConvexError("That day already rolled over.");
    }

    // Reconcile the self-reported cloud when the answer changes.
    const existingCloud = await ctx.db
      .query("clouds")
      .withIndex("userDay", (q) => q.eq("userId", user._id).eq("day", today))
      // eslint-disable-next-line @convex-dev/no-filter-in-query -- narrows one user-day (a handful of rows) by source; a source index would be overkill
      .filter((q) => q.eq(q.field("source"), "pushups_storm"))
      .unique();
    if (args.status === "storm" && existingCloud === null) {
      await ctx.db.insert("clouds", {
        userId: user._id,
        day: today,
        count: 1,
        source: "pushups_storm",
      });
    } else if (args.status === "star" && existingCloud !== null) {
      await ctx.db.delete("clouds", existingCloud._id);
    }

    if (existing === null) {
      await ctx.db.insert("checkins", {
        userId: user._id,
        day: today,
        status: args.status,
      });
    } else {
      await ctx.db.patch("checkins", existing._id, { status: args.status });
    }
    // Announce a fresh ⭐️ to clubmates who opted in (not on re-toggles).
    if (args.status === "star" && existing?.status !== "star") {
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
