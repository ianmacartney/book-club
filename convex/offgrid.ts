import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, mutation, query } from "./_generated/server";
import {
  clubMemberships,
  hasActiveMembership,
  isGhost,
  requireMembership,
  requireUser,
} from "./lib/access";
import {
  addDays,
  diffDays,
  isValidDay,
  readerDay,
  todayInTz,
  viewerDay,
} from "./lib/days";
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

/**
 * The rules an absence has to satisfy whoever is writing it: real days, in
 * order, no longer than the cap, and not overlapping another of your own.
 * `exclude` is the period being edited, which can't clash with itself.
 */
async function checkRange(
  ctx: MutationCtx,
  userId: Id<"users">,
  fromDay: string,
  toDay: string,
  exclude?: Id<"offGridPeriods">,
): Promise<void> {
  for (const day of [fromDay, toDay]) {
    if (!isValidDay(day)) {
      throw new ConvexError(`"${day}" isn't a day (expected yyyy-MM-dd).`);
    }
  }
  if (toDay < fromDay) {
    throw new ConvexError("The last day away can't be before the first.");
  }
  if (diffDays(toDay, fromDay) + 1 > MAX_OFF_GRID_DAYS) {
    throw new ConvexError(
      `That's longer than ${MAX_OFF_GRID_DAYS} days — declare it in stretches.`,
    );
  }
  const clashes = (
    await overlappingPeriods(ctx, userId, fromDay, toDay)
  ).filter((p) => p._id !== exclude);
  if (clashes.length > 0) {
    const [first] = clashes;
    throw new ConvexError(
      `That overlaps the absence you already have for ${first.fromDay} → ` +
        `${first.toDay}.`,
    );
  }
}

function cleanNote(note: string | undefined): string | undefined {
  const trimmed = note?.trim();
  if (trimmed !== undefined && trimmed.length > MAX_NOTE_CHARS) {
    throw new ConvexError("Keep the note short.");
  }
  return trimmed || undefined;
}

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
    if (isValidDay(fromDay) && fromDay < today) {
      throw new ConvexError(
        "Off-grid periods are declared up front — the earliest start is today.",
      );
    }
    await checkRange(ctx, user._id, fromDay, args.toDay);
    return await ctx.db.insert("offGridPeriods", {
      userId: user._id,
      fromDay,
      toDay: args.toDay,
      note: cleanNote(args.note),
      declaredBy: user._id,
    });
  },
});

/**
 * Change the dates or the note on an absence you already declared — plans
 * move. The start of a period already under way is fixed, since those days
 * have been reckoned, but its end can still shift. Passing `note: null`
 * clears it; omitting a field leaves it alone.
 */
export const update = mutation({
  args: {
    periodId: v.id("offGridPeriods"),
    fromDay: v.optional(v.string()),
    toDay: v.optional(v.string()),
    note: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const period = await ctx.db.get("offGridPeriods", args.periodId);
    if (period === null || period.userId !== user._id) {
      throw new ConvexError("That's not one of your off-grid periods.");
    }
    const today = todayInTz(user.timezone);
    const fromDay = args.fromDay ?? period.fromDay;
    const toDay = args.toDay ?? period.toDay;
    if (period.fromDay <= today && fromDay !== period.fromDay) {
      throw new ConvexError(
        "That absence has already begun — you can move its end, not its start.",
      );
    }
    if (period.fromDay > today && fromDay < today) {
      throw new ConvexError("An absence can't start in the past.");
    }
    await checkRange(ctx, user._id, fromDay, toDay, period._id);
    await ctx.db.patch("offGridPeriods", period._id, {
      fromDay,
      toDay,
      // Days already spent away keep the ⛈️ they were billed, so shortening
      // one is a change of plan, not a refund.
      note:
        args.note === undefined
          ? period.note
          : cleanNote(args.note ?? undefined),
    });
    return null;
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
  // "Current and upcoming" is reckoned against the reader's own day, so it
  // has to come in as an argument — see `viewerDay` in lib/days.
  args: { viewerDay },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const today = readerDay(args.viewerDay, user.timezone);
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
  args: { clubId: v.id("clubs"), viewerDay },
  handler: async (ctx, args) => {
    const viewer = await requireMembership(ctx, args.clubId);
    const viewerToday = readerDay(args.viewerDay, viewer.timezone);
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
          // The reader's own day is theirs to declare; everyone else's runs
          // on their own timezone, same as in `clubs:home`.
          const today =
            user._id === viewer._id ? viewerToday : todayInTz(user.timezone);
          const periods = await overlappingPeriods(
            ctx,
            user._id,
            today,
            addDays(today, 365),
          );
          return periods.map((p) => ({
            userId: user._id,
            name: user.name,
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
  args: { viewerDay },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const today = readerDay(args.viewerDay, user.timezone);
    const period = await offGridOn(ctx, user._id, today);
    return period === null ? null : shape(period, today);
  },
});
