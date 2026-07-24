import { Doc, Id } from "../_generated/dataModel";
import { MutationCtx, QueryCtx } from "../_generated/server";
import { addDays, diffDays } from "./days";

/**
 * Sum a member's stormy clouds over an inclusive day range, as seen by one
 * club. Personal clouds (pushups — no clubId) rain on you in every club you
 * belong to; club-tagged clouds (late/skipped sections) only count in the
 * club whose book they came from.
 */
export async function cloudsForUser(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  clubId: Id<"clubs">,
  fromDay: string,
  toDay?: string,
): Promise<number> {
  const entries = await ctx.db
    .query("clouds")
    .withIndex("userDay", (q) => {
      const from = q.eq("userId", userId).gte("day", fromDay);
      return toDay === undefined ? from : from.lte("day", toDay);
    })
    .collect();
  return entries
    .filter((e) => e.clubId === undefined || e.clubId === clubId)
    .reduce((sum, e) => sum + e.count, 0);
}

export async function tallyClouds(
  ctx: QueryCtx | MutationCtx,
  userIds: Id<"users">[],
  clubId: Id<"clubs">,
  fromDay: string,
  toDay?: string,
): Promise<{ userId: Id<"users">; clouds: number }[]> {
  return Promise.all(
    userIds.map(async (userId) => ({
      userId,
      clouds: await cloudsForUser(ctx, userId, clubId, fromDay, toDay),
    })),
  );
}

/**
 * Bill 2 clouds for every full day a section is overdue, one ledger entry
 * per late day, idempotent on (sectionId, day). Called by the hourly cron
 * and again at submission time, so a section settled between cron runs
 * can't dodge its final late day.
 */
export async function accrueLateClouds(
  ctx: MutationCtx,
  book: Doc<"books">,
  section: Doc<"sections">,
  assigneeToday: string,
): Promise<void> {
  if (section.dueDay === undefined) {
    return;
  }
  const daysLate = diffDays(assigneeToday, section.dueDay);
  for (let k = 1; k <= daysLate; k++) {
    const lateDay = addDays(section.dueDay, k);
    const existing = await ctx.db
      .query("clouds")
      .withIndex("sectionDay", (q) =>
        q.eq("sectionId", section._id).eq("day", lateDay),
      )
      .filter((q) => q.eq(q.field("source"), "section_late"))
      .unique();
    if (existing === null) {
      await ctx.db.insert("clouds", {
        userId: section.assignedTo,
        day: lateDay,
        count: 2,
        source: "section_late",
        clubId: book.clubId,
        bookId: book._id,
        sectionId: section._id,
      });
    }
  }
}
