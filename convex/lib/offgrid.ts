import { Doc, Id } from "../_generated/dataModel";
import { MutationCtx, QueryCtx } from "../_generated/server";
import { addDays, isPushupDay } from "./days";

/**
 * Off-grid periods. A member says up front that they'll be out of service and
 * commits to one storm (1 cloud) for every required day they're away — better
 * than the 2 clouds silence costs, worse than showing up.
 *
 * Declaring a period bills nothing. The hourly rollover settles each day as it
 * ends, exactly as it does for silence, which means a member who turns out to
 * have signal can still report a ⭐️ and beat their own commitment. Sundays are
 * free while away, same as ever.
 */

/** Longest declarable absence. Also bounds the index scans below. */
export const MAX_OFF_GRID_DAYS = 90;

/**
 * Periods overlapping the inclusive range, for this member.
 *
 * The index is on `fromDay`, so the scan starts a maximum period's length
 * before the range and keeps the rows whose `toDay` reaches into it. Anything
 * longer than MAX_OFF_GRID_DAYS would slip past that window, which is why the
 * mutations that write these rows enforce the cap.
 */
export async function overlappingPeriods(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  fromDay: string,
  toDay: string,
): Promise<Doc<"offGridPeriods">[]> {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- indexed to a bounded day window
  const periods = await ctx.db
    .query("offGridPeriods")
    .withIndex("userFrom", (q) =>
      q
        .eq("userId", userId)
        .gte("fromDay", addDays(fromDay, -MAX_OFF_GRID_DAYS))
        .lte("fromDay", toDay),
    )
    .collect();
  return periods.filter((p) => p.toDay >= fromDay);
}

/** The period covering `day` for this member, if they declared one. */
export async function offGridOn(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  day: string,
): Promise<Doc<"offGridPeriods"> | null> {
  const covering = await overlappingPeriods(ctx, userId, day, day);
  return covering[0] ?? null;
}

/**
 * Rewrite days in a period that already rolled over as silence (2 clouds)
 * into the storm (1 cloud) the member committed to. Only "missed" check-ins
 * are touched — a real ⭐️ or a self-reported ⛈️ is the member's own word and
 * stands. Idempotent, and only ever looks at days that have fully elapsed.
 *
 * Used by the admin path, where a period can be filed after the fact ("he
 * told us last week and we forgot to record it").
 */
export async function settleOffGridDays(
  ctx: MutationCtx,
  userId: Id<"users">,
  fromDay: string,
  toDay: string,
  memberToday: string,
): Promise<number> {
  const lastSettled = toDay < memberToday ? toDay : addDays(memberToday, -1);
  let converted = 0;
  for (let day = fromDay; day <= lastSettled; day = addDays(day, 1)) {
    if (!isPushupDay(day)) {
      continue;
    }
    const checkin = await ctx.db
      .query("checkins")
      .withIndex("userDay", (q) => q.eq("userId", userId).eq("day", day))
      .unique();
    if (checkin === null || checkin.status !== "missed") {
      continue;
    }
    await ctx.db.patch("checkins", checkin._id, { status: "storm" });
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- one member-day of the ledger — a handful of rows
    const ledger = await ctx.db
      .query("clouds")
      .withIndex("userDay", (q) => q.eq("userId", userId).eq("day", day))
      .collect();
    for (const entry of ledger) {
      if (entry.source === "pushups_missed") {
        await ctx.db.delete("clouds", entry._id);
      }
    }
    if (!ledger.some((e) => e.source === "pushups_storm")) {
      await ctx.db.insert("clouds", {
        userId,
        day,
        count: 1,
        source: "pushups_storm",
      });
    }
    converted++;
  }
  return converted;
}
