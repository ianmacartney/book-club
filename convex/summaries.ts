import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { clubMemberIds, requireMembership } from "./lib/access";
import { cloudsForUser } from "./lib/clouds";
import { addDays, todayInTz } from "./lib/days";

/** Every Sunday: snapshot each club's stormy-cloud standings. */
export const compileAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const weekEndingDay = todayInTz("UTC");
    const weekStartDay = addDays(weekEndingDay, -6);
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- all clubs — a handful
    const clubs = await ctx.db.query("clubs").collect();
    for (const club of clubs) {
      const existing = await ctx.db
        .query("summaries")
        .withIndex("clubWeek", (q) =>
          q.eq("clubId", club._id).eq("weekEndingDay", weekEndingDay),
        )
        .unique();
      if (existing !== null) {
        continue;
      }
      const memberIds = await clubMemberIds(ctx, club._id);
      if (memberIds.length === 0) {
        continue;
      }
      const activeBook = await ctx.db
        .query("books")
        .withIndex("clubStatus", (q) =>
          q.eq("clubId", club._id).eq("status", "active"),
        )
        .first();
      const entries = [];
      for (const userId of memberIds) {
        // Bounded above by the snapshot day so members ahead of UTC don't
        // leak next week's clouds into this summary (and again next week).
        entries.push({
          userId,
          weekClouds: await cloudsForUser(
            ctx,
            userId,
            club._id,
            weekStartDay,
            weekEndingDay,
          ),
          bookClouds: activeBook
            ? await cloudsForUser(
                ctx,
                userId,
                club._id,
                activeBook.startedDay,
                weekEndingDay,
              )
            : 0,
        });
      }
      entries.sort((a, b) => b.weekClouds - a.weekClouds);
      await ctx.db.insert("summaries", {
        clubId: club._id,
        weekEndingDay,
        bookId: activeBook?._id,
        entries,
      });
    }
  },
});

/** Recent Sunday summaries for the club, newest first. */
export const forClub = query({
  args: { clubId: v.id("clubs") },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.clubId);
    const summaries = await ctx.db
      .query("summaries")
      .withIndex("clubWeek", (q) => q.eq("clubId", args.clubId))
      .order("desc")
      .take(8);
    return Promise.all(
      summaries.map(async (s) => ({
        _id: s._id,
        weekEndingDay: s.weekEndingDay,
        entries: await Promise.all(
          s.entries.map(async (e) => {
            const u = await ctx.db.get("users", e.userId);
            return { ...e, name: u?.name ?? u?.username ?? "former member" };
          }),
        ),
      })),
    );
  },
});
