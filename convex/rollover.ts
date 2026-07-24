import { internalMutation } from "./_generated/server";
import { accrueLateClouds } from "./lib/clouds";
import { addDays, dayInTz, isPushupDay, todayInTz } from "./lib/days";

/** How far back the missed-pushups sweep looks, in case cron runs were missed. */
const CATCH_UP_DAYS = 7;

/**
 * The hourly reckoning. Both halves are idempotent, so running every hour
 * just means each member's midnight is honored within the hour:
 *
 *  1. Anyone whose day ended without a pushup report gets a "missed"
 *     check-in and 2 stormy clouds — swept over the last week so a cron
 *     outage can't quietly forgive a day.
 *  2. Every active book's current section accrues 2 clouds per full day
 *     it's overdue, reckoned in the assignee's timezone.
 */
export const processAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    // --- 1. Missed pushups -------------------------------------------------
    const users = await ctx.db.query("users").collect();
    for (const user of users) {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("userId", (q) => q.eq("userId", user._id))
        .first();
      if (membership === null) {
        continue; // not in any club yet, nothing at stake
      }
      const today = todayInTz(user.timezone);
      // Pushups are only at stake once you've joined a club (`.first()` on
      // the index is the oldest membership).
      const atStakeSince = dayInTz(membership._creationTime, user.timezone);
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
        await ctx.db.insert("checkins", {
          userId: user._id,
          day,
          status: "missed",
        });
        await ctx.db.insert("clouds", {
          userId: user._id,
          day,
          count: 2,
          source: "pushups_missed",
        });
      }
    }

    // --- 2. Overdue sections ----------------------------------------------
    const activeBooks = await ctx.db
      .query("books")
      .withIndex("status", (q) => q.eq("status", "active"))
      .collect();
    for (const book of activeBooks) {
      const sections = await ctx.db
        .query("sections")
        .withIndex("bookIdx", (q) => q.eq("bookId", book._id))
        .collect();
      sections.sort((a, b) => a.index - b.index);
      const current = sections.find((s) => s.submission === undefined);
      if (current === undefined) {
        continue;
      }
      const assignee = await ctx.db.get(current.assignedTo);
      await accrueLateClouds(ctx, book, current, todayInTz(assignee?.timezone));
    }
  },
});
