import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, QueryCtx, mutation, query } from "./_generated/server";
import { isGhost, requireMembership, requireMembershipRow } from "./lib/access";
import { isPushupDay, readerDay, viewerDay } from "./lib/days";

/**
 * The quote of the day: a line one of you pulled out of a book years ago,
 * dealt back to the club one day at a time. Reporting your pushups is what
 * unlocks it — a small reward for committing to an answer.
 *
 * The deck (schema.ts `quotes`) is a fixed random permutation: every quote
 * carries a random `sort` in [0, 1), and each day takes the next `sort` above
 * the day before, wrapping at the end. So nothing repeats until the whole
 * deck has been dealt (~520 quotes ≈ 1.7 years), and a quote submitted today
 * lands at a random spot in the remaining cycle instead of at the back.
 */

// Below the floor it's a fragment or a stray "..."; above the ceiling it's
// somebody's whole paragraph of commentary, not a quote.
const MIN_QUOTE_CHARS = 20;
const MAX_QUOTE_CHARS = 500;

/**
 * Pull the individual quotes out of one submission's free-text field. Members
 * separate multiple pulls with a blank line; when there isn't one, fall back
 * to single newlines. Anything outside the length band is dropped.
 *
 * This is a heuristic over eight years of text pasted out of iMessage, so it
 * will occasionally promote a line of commentary. That's what hiding is for —
 * curation happens as duds surface, not up front.
 */
export function splitQuotes(raw: string): string[] {
  const paragraphs = raw.split(/\n\s*\n/);
  const chunks = paragraphs.length > 1 ? paragraphs : raw.split(/\n/);
  return chunks
    .map((chunk) =>
      chunk
        .trim()
        .replace(/^[-–—•*]\s+/, "")
        .trim(),
    )
    .filter(
      (chunk) =>
        chunk.length >= MIN_QUOTE_CHARS && chunk.length <= MAX_QUOTE_CHARS,
    );
}

/**
 * Add a submission's quotes to the club's deck. Idempotent per section, so
 * re-running the historical backfill is free.
 */
export async function indexSectionQuotes(
  ctx: MutationCtx,
  args: {
    clubId: Id<"clubs">;
    bookId: Id<"books">;
    sectionId: Id<"sections">;
    submittedBy: Id<"users">;
    submittedDay: string;
    raw: string;
  },
): Promise<number> {
  const already = await ctx.db
    .query("quotes")
    .withIndex("section", (q) => q.eq("sectionId", args.sectionId))
    .first();
  if (already !== null) {
    return 0;
  }
  const texts = splitQuotes(args.raw);
  for (const text of texts) {
    await ctx.db.insert("quotes", {
      clubId: args.clubId,
      text,
      // Where this quote falls in the shuffle.
      sort: Math.random(),
      hidden: false,
      sectionId: args.sectionId,
      bookId: args.bookId,
      submittedBy: args.submittedBy,
      submittedDay: args.submittedDay,
    });
  }
  return texts.length;
}

/** The next live quote after `cursor`, wrapping to the top of the deck. */
async function nextInDeck(
  ctx: MutationCtx,
  clubId: Id<"clubs">,
  cursor: number,
): Promise<Doc<"quotes"> | null> {
  const next = await ctx.db
    .query("quotes")
    .withIndex("clubDeck", (q) =>
      q.eq("clubId", clubId).eq("hidden", false).gt("sort", cursor),
    )
    .first();
  if (next !== null) {
    return next;
  }
  // Past the last card — start the next pass through the deck.
  return await ctx.db
    .query("quotes")
    .withIndex("clubDeck", (q) => q.eq("clubId", clubId).eq("hidden", false))
    .first();
}

/**
 * Ensure a club has a quote for `day`. Called by the hourly cron for each
 * distinct local day its members are on, so Sundays get one too even though
 * nobody checks in. Idempotent — the first run of the day mints, the rest
 * find the row and stop.
 */
export async function mintDailyQuote(
  ctx: MutationCtx,
  clubId: Id<"clubs">,
  day: string,
): Promise<void> {
  const existing = await ctx.db
    .query("dailyQuotes")
    .withIndex("clubDay", (q) => q.eq("clubId", clubId).eq("day", day))
    .unique();
  if (existing !== null) {
    return;
  }
  // The deck cursor is wherever the most recently minted day landed — the
  // *highest* day on record, deliberately, not the calendar day before this
  // one. Members straddle timezones, so two days can be in play at once; if
  // each stepped from "the day before me" they'd both read the same cursor
  // and deal the same card. Taking the max means each mint advances the deck,
  // at the cost of two straddling days occasionally being dealt out of order
  // — invisible, since the deck order is random to begin with.
  //
  // Floats are in [0, 1), so -1 starts a brand-new club at the top.
  const last = await ctx.db
    .query("dailyQuotes")
    .withIndex("clubDay", (q) => q.eq("clubId", clubId))
    .order("desc")
    .first();
  const pick = await nextInDeck(ctx, clubId, last?.sort ?? -1);
  if (pick === null) {
    return; // empty deck — a club with no submitted quotes yet
  }
  await ctx.db.insert("dailyQuotes", {
    clubId,
    day,
    quoteId: pick._id,
    text: pick.text,
    sort: pick.sort,
  });
}

async function reactionsFor(
  ctx: QueryCtx,
  quoteId: Id<"quotes">,
): Promise<Doc<"quoteReactions">[]> {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- at most one row per club member
  return await ctx.db
    .query("quoteReactions")
    .withIndex("quoteUser", (q) => q.eq("quoteId", quoteId))
    .collect();
}

/**
 * Today's quote, if the viewer has earned it.
 *
 * The gate is enforced here rather than in the UI on purpose: an unearned
 * client never receives the text, so it can't be read off the wire. Sundays
 * are free (there's nothing to report), and so are ghosts — they owe no
 * pushups, so they could never unlock it.
 */
export const today = query({
  args: { clubId: v.id("clubs"), viewerDay },
  handler: async (ctx, args) => {
    const { user, membership } = await requireMembershipRow(ctx, args.clubId);
    const day = readerDay(args.viewerDay, user.timezone);
    const daily = await ctx.db
      .query("dailyQuotes")
      .withIndex("clubDay", (q) => q.eq("clubId", args.clubId).eq("day", day))
      .unique();
    if (daily === null) {
      return null; // nothing minted for today
    }
    const checkin = await ctx.db
      .query("checkins")
      .withIndex("userDay", (q) => q.eq("userId", user._id).eq("day", day))
      .unique();
    const earned = !isPushupDay(day) || isGhost(membership) || checkin !== null;
    if (!earned) {
      return { earned: false as const };
    }

    const quote = await ctx.db.get("quotes", daily.quoteId);
    const book =
      quote?.bookId === undefined
        ? null
        : await ctx.db.get("books", quote.bookId);
    const section =
      quote?.sectionId === undefined
        ? null
        : await ctx.db.get("sections", quote.sectionId);
    const submitter =
      quote?.submittedBy === undefined
        ? null
        : await ctx.db.get("users", quote.submittedBy);
    const reactions = await reactionsFor(ctx, daily.quoteId);

    return {
      earned: true as const,
      quoteId: daily.quoteId,
      // The frozen copy, not `quote.text` — what the club saw today stands
      // even if the quote is later reworded or hidden.
      text: daily.text,
      bookTitle: book?.title ?? null,
      sectionTitle: section?.title ?? null,
      // Attribution resolves live so a rename flows through.
      submittedByName: submitter?.name ?? null,
      submittedDay: quote?.submittedDay ?? null,
      up: reactions.filter((r) => r.reaction === "up").length,
      down: reactions.filter((r) => r.reaction === "down").length,
      myReaction:
        reactions.find((r) => r.userId === user._id)?.reaction ?? null,
    };
  },
});

/**
 * 👍/👎 a quote, or pass `null` to take it back. Freely changeable — unlike a
 * check-in, nothing is at stake. Today these only record an opinion; hiding
 * and re-ranking off the back of them is a later job.
 */
export const react = mutation({
  args: {
    quoteId: v.id("quotes"),
    reaction: v.union(v.literal("up"), v.literal("down"), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const quote = await ctx.db.get("quotes", args.quoteId);
    if (quote === null) {
      throw new ConvexError("Quote not found.");
    }
    const user = await requireMembership(ctx, quote.clubId);
    const existing = await ctx.db
      .query("quoteReactions")
      .withIndex("quoteUser", (q) =>
        q.eq("quoteId", args.quoteId).eq("userId", user._id),
      )
      .unique();
    if (args.reaction === null) {
      if (existing !== null) {
        await ctx.db.delete("quoteReactions", existing._id);
      }
      return null;
    }
    if (existing === null) {
      await ctx.db.insert("quoteReactions", {
        userId: user._id,
        quoteId: args.quoteId,
        reaction: args.reaction,
      });
    } else {
      await ctx.db.patch("quoteReactions", existing._id, {
        reaction: args.reaction,
      });
    }
    return null;
  },
});
