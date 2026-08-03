import { internalMutation } from "./_generated/server";
import { accrueLateClouds } from "./lib/clouds";
import { addDays, dayInTz, isPushupDay, todayInTz } from "./lib/days";
import { offGridOn } from "./lib/offgrid";

/** How far back the missed-pushups sweep looks, in case cron runs were missed. */
const CATCH_UP_DAYS = 7;

/**
 * The hourly reckoning. Both halves are idempotent, so running every hour
 * just means each member's midnight is honored within the hour:
 *
 *  1. Anyone whose day ended without a pushup report gets a "missed"
 *     check-in and 2 stormy clouds — swept over the last week so a cron
 *     outage can't quietly forgive a day. Days inside a declared off-grid
 *     period settle as a ⛈️ (1 cloud) instead.
 *  2. Every active book's current section accrues 2 clouds per full day
 *     it's overdue, reckoned in the assignee's timezone.
 */
export const processAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    // --- 1. Missed pushups -------------------------------------------------
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- all members + ghosts — a few dozen; matched case-insensitively
    const users = await ctx.db.query("users").collect();
    for (const user of users) {
      // Ghost memberships carry no obligations, so only full memberships
      // put pushups at stake (the oldest one starts the clock).
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- a user's club memberships — a small bounded set
      const memberships = await ctx.db
        .query("memberships")
        .withIndex("userId", (q) => q.eq("userId", user._id))
        .collect();
      const active = memberships.filter((m) => m.role !== "ghost");
      if (active.length === 0) {
        continue; // not a full member of any club, nothing at stake
      }
      const today = todayInTz(user.timezone);
      const atStakeSince = dayInTz(
        Math.min(...active.map((m) => m._creationTime)),
        user.timezone,
      );
      for (let back = 1; back <= CATCH_UP_DAYS; back++) {
        const day = addDays(today, -back);
        // Not required on Sundays or before joining.
        if (!isPushupDay(day) || day < atStakeSince) {
          continue;
        }
        const checkin = await ctx.db
          .query("checkins")
          .withIndex("userDay", (q) => q.eq("userId", user._id).eq("day", day))
          .unique();
        if (checkin !== null) {
          continue;
        }
        // A declared absence caps the day at the storm they committed to.
        const away = (await offGridOn(ctx, user._id, day)) !== null;
        await ctx.db.insert("checkins", {
          userId: user._id,
          day,
          status: away ? "storm" : "missed",
        });
        await ctx.db.insert("clouds", {
          userId: user._id,
          day,
          count: away ? 1 : 2,
          source: away ? "pushups_storm" : "pushups_missed",
        });
      }
    }

    // --- 2. Overdue sections ----------------------------------------------
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- active books — one per club, bounded
    const activeBooks = await ctx.db
      .query("books")
      .withIndex("status", (q) => q.eq("status", "active"))
      .collect();
    for (const book of activeBooks) {
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- one book's sections — bounded (<1000/book, dozens in practice)
      const sections = await ctx.db
        .query("sections")
        .withIndex("bookIdx", (q) => q.eq("bookId", book._id))
        .collect();
      sections.sort((a, b) => a.index - b.index);
      const current = sections.find((s) => s.submission === undefined);
      if (current === undefined) {
        continue;
      }
      const assignee = await ctx.db.get("users", current.assignedTo);
      await accrueLateClouds(ctx, book, current, todayInTz(assignee?.timezone));
    }
  },
});
