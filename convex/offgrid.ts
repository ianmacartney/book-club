import { ConvexError, v } from "convex/values";
import { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import {
  clubMemberships,
  hasActiveMembership,
  isGhost,
  requireMembership,
  requireUser,
} from "./lib/access";
import { addDays, diffDays, isValidDay, todayInTz } from "./lib/days";
import {
  MAX_OFF_GRID_DAYS,
  offGridOn,
  overlappingPeriods,
} from "./lib/offgrid";

/**
 * Going off the grid: declare an absence up front and owe one storm per
 * required day away instead of the 2 clouds silence costs. See
 * `convex/lib/offgrid.ts` for how the days are settled.
 */

const MAX_NOTE_CHARS = 200;

function shape(period: Doc<"offGridPeriods">, today: string) {
  return {
    _id: period._id,
    fromDay: period.fromDay,
    toDay: period.toDay,
    note: period.note ?? null,
    active: period.fromDay <= today && today <= period.toDay,
  };
}

/**
 * Announce an absence. Defaults to starting today; can't start in the past,
 * because those days have already been reckoned (an admin can file a
 * backdated one with `setup:setOffGrid`, which corrects the ledger).
 */
export const declare = mutation({
  args: {
    fromDay: v.optional(v.string()), // member's local day; defaults to today
    toDay: v.string(), // inclusive — the last day you're away
    note: v.optional(v.string()),
  },
  returns: v.id("offGridPeriods"),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (!(await hasActiveMembership(ctx, user._id))) {
      throw new ConvexError("Ghosts owe no pushups — nothing to declare.");
    }
    const today = todayInTz(user.timezone);
    const fromDay = args.fromDay ?? today;
    for (const day of [fromDay, args.toDay]) {
      if (!isValidDay(day)) {
        throw new ConvexError(`"${day}" isn't a day (expected yyyy-MM-dd).`);
      }
    }
    if (fromDay < today) {
      throw new ConvexError(
        "Off-grid periods are declared up front — the earliest start is today.",
      );
    }
    if (args.toDay < fromDay) {
      throw new ConvexError("The last day away can't be before the first.");
    }
    if (diffDays(args.toDay, fromDay) + 1 > MAX_OFF_GRID_DAYS) {
      throw new ConvexError(
        `That's longer than ${MAX_OFF_GRID_DAYS} days — declare it in stretches.`,
      );
    }
    const note = args.note?.trim();
    if (note !== undefined && note.length > MAX_NOTE_CHARS) {
      throw new ConvexError("Keep the note short.");
    }
    const clashes = await overlappingPeriods(
      ctx,
      user._id,
      fromDay,
      args.toDay,
    );
    if (clashes.length > 0) {
      const [first] = clashes;
      throw new ConvexError(
        `You're already off the grid ${first.fromDay} → ${first.toDay}. ` +
          `Cancel that first if the dates changed.`,
      );
    }
    return await ctx.db.insert("offGridPeriods", {
      userId: user._id,
      fromDay,
      toDay: args.toDay,
      note: note || undefined,
      declaredBy: user._id,
    });
  },
});

/**
 * Back early (or never left). A period that hasn't started is dropped; one
 * already under way ends yesterday, so today is a normal day again and the
 * days already spent away keep what they were billed.
 */
export const cancel = mutation({
  args: { periodId: v.id("offGridPeriods") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const period = await ctx.db.get("offGridPeriods", args.periodId);
    if (period === null || period.userId !== user._id) {
      throw new ConvexError("That's not one of your off-grid periods.");
    }
    const today = todayInTz(user.timezone);
    if (period.fromDay >= today) {
      await ctx.db.delete("offGridPeriods", period._id);
    } else if (period.toDay >= today) {
      await ctx.db.patch("offGridPeriods", period._id, {
        toDay: addDays(today, -1),
      });
    } else {
      throw new ConvexError("That absence is already over.");
    }
    return null;
  },
});

/** The viewer's current and upcoming absences, soonest first. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const today = todayInTz(user.timezone);
    const periods = await overlappingPeriods(
      ctx,
      user._id,
      today,
      addDays(today, 365),
    );
    return periods
      .sort((a, b) => a.fromDay.localeCompare(b.fromDay))
      .map((p) => shape(p, today));
  },
});

/** Who in the club is away or about to be — for the roster and standings. */
export const forClub = query({
  args: { clubId: v.id("clubs") },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.clubId);
    const memberships = await clubMemberships(ctx, args.clubId);
    const rows = await Promise.all(
      // Ghosts owe no pushups, so they're never off the grid.
      memberships
        .filter((m) => !isGhost(m))
        .map(async (m) => {
          const user = await ctx.db.get("users", m.userId);
          if (user === null) {
            return [];
          }
          const today = todayInTz(user.timezone);
          const periods = await overlappingPeriods(
            ctx,
            user._id,
            today,
            addDays(today, 365),
          );
          return periods.map((p) => ({
            userId: user._id,
            name: user.name ?? user.username,
            ...shape(p, today),
          }));
        }),
    );
    return rows
      .flat()
      .sort(
        (a, b) =>
          a.fromDay.localeCompare(b.fromDay) || a.name.localeCompare(b.name),
      );
  },
});

/** Is the viewer off the grid right now? Cheap check for the check-in UI. */
export const viewerStatus = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const today = todayInTz(user.timezone);
    const period = await offGridOn(ctx, user._id, today);
    return period === null ? null : shape(period, today);
  },
});
