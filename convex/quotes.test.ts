import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { mintDailyQuote } from "./quotes";

const modules = import.meta.glob("./**/*.ts");

// A Monday, so the quote has to be earned — every member below checks in.
const DAY = "2026-08-31";
const NEXT_DAY = "2026-09-01";
const TZ = "America/Los_Angeles";

/**
 * A club of three with a deck whose order is known: one quote per `sort`
 * passed in, dealt in that order. Nothing is minted yet.
 */
async function club(sorts: number[]) {
  const t = convexTest(schema, modules);
  const seed = await t.run(async (ctx) => {
    const ian = await ctx.db.insert("users", { name: "Ian M", timezone: TZ });
    const peter = await ctx.db.insert("users", { name: "Peter", timezone: TZ });
    const henry = await ctx.db.insert("users", { name: "Henry", timezone: TZ });
    const clubId = await ctx.db.insert("clubs", {
      name: "Push Up Club",
      createdBy: ian,
    });
    for (const userId of [ian, peter, henry]) {
      await ctx.db.insert("memberships", { clubId, userId });
      for (const day of [DAY, NEXT_DAY]) {
        await ctx.db.insert("checkins", { userId, day, status: "star" });
      }
    }
    const quoteIds: Id<"quotes">[] = [];
    for (const [i, sort] of sorts.entries()) {
      quoteIds.push(
        await ctx.db.insert("quotes", {
          clubId,
          text: `Card ${i}: a line somebody pulled out of a book.`,
          sort,
          hidden: false,
        }),
      );
    }
    return { clubId, ian, peter, henry, quoteIds };
  });
  return {
    t,
    ...seed,
    /** Deal `day` its card, the way the hourly cron does. */
    mint: (day: string) =>
      t.run(async (ctx) => await mintDailyQuote(ctx, seed.clubId, day)),
    react: (
      userId: Id<"users">,
      quoteId: Id<"quotes">,
      reaction: "up" | "down" | null,
      viewerDay = DAY,
    ) =>
      t
        .withIdentity({ subject: userId })
        .mutation(api.quotes.react, { quoteId, reaction, viewerDay }),
    /** What a member is shown, as the app asks for it. */
    seenBy: (userId: Id<"users">, viewerDay = DAY) =>
      t
        .withIdentity({ subject: userId })
        .query(api.quotes.today, { clubId: seed.clubId, viewerDay }),
    /** The raw row, for assertions the query deliberately doesn't expose. */
    dailyRow: (day: string): Promise<Doc<"dailyQuotes"> | null> =>
      t.run(
        async (ctx) =>
          await ctx.db
            .query("dailyQuotes")
            .withIndex("clubDay", (q) =>
              q.eq("clubId", seed.clubId).eq("day", day),
            )
            .unique(),
      ),
    quote: (quoteId: Id<"quotes">) =>
      t.run(async (ctx) => await ctx.db.get("quotes", quoteId)),
  };
}

describe("the club's veto", () => {
  test("more 👎 than 👍 pulls the quote and deals the day a new card", async () => {
    const c = await club([0.1, 0.2, 0.3]);
    const [a, b] = c.quoteIds;
    await c.mint(DAY);
    expect((await c.dailyRow(DAY))?.quoteId).toBe(a);

    await c.react(c.ian, a, "down");

    expect((await c.quote(a))?.hidden).toBe(true);
    expect((await c.dailyRow(DAY))?.quoteId).toBe(b);
    // Not just for the member who voted — the day itself moved on.
    const seen = await c.seenBy(c.peter);
    expect(seen).toMatchObject({ earned: true, quoteId: b, up: 0, down: 0 });
  });

  test("a 👍 holds the line until the 👎s outnumber it", async () => {
    const c = await club([0.1, 0.2, 0.3]);
    const [a, b] = c.quoteIds;
    await c.mint(DAY);

    await c.react(c.peter, a, "up");
    await c.react(c.ian, a, "down");
    // Level at 1–1: "more negative than positive" isn't met.
    expect((await c.quote(a))?.hidden).toBe(false);
    expect((await c.dailyRow(DAY))?.quoteId).toBe(a);

    await c.react(c.henry, a, "down");
    expect((await c.quote(a))?.hidden).toBe(true);
    expect((await c.dailyRow(DAY))?.quoteId).toBe(b);
  });

  test("withdrawing the 👎 restores nothing — the veto is one-way", async () => {
    const c = await club([0.1, 0.2, 0.3]);
    const [a, b] = c.quoteIds;
    await c.mint(DAY);
    await c.react(c.ian, a, "down");

    await c.react(c.ian, a, null);

    expect((await c.quote(a))?.hidden).toBe(true);
    expect((await c.dailyRow(DAY))?.quoteId).toBe(b);
  });

  test("vetoing the replacement deals on past what's already out", async () => {
    const c = await club([0.1, 0.2, 0.3]);
    const [a, b, cc] = c.quoteIds;
    await c.mint(DAY);

    await c.react(c.ian, a, "down");
    await c.react(c.ian, b, "down");

    expect((await c.dailyRow(DAY))?.quoteId).toBe(cc);
    expect((await c.quote(b))?.hidden).toBe(true);
  });

  test("vetoing the last live card leaves the day without one", async () => {
    const c = await club([0.1]);
    const [only] = c.quoteIds;
    await c.mint(DAY);

    await c.react(c.ian, only, "down");

    expect(await c.dailyRow(DAY)).toBe(null);
    expect(await c.seenBy(c.ian)).toBe(null);
  });

  test("a quote that isn't the day's card is pulled without disturbing it", async () => {
    const c = await club([0.1, 0.2, 0.3]);
    const [a, , cc] = c.quoteIds;
    await c.mint(DAY);

    await c.react(c.ian, cc, "down");

    expect((await c.quote(cc))?.hidden).toBe(true);
    expect((await c.dailyRow(DAY))?.quoteId).toBe(a);
  });

  test("another day in play keeps its own card", async () => {
    // Members straddle timezones, so two local days can be live at once.
    const c = await club([0.1, 0.2, 0.3]);
    const [a, b, cc] = c.quoteIds;
    await c.mint(DAY);
    await c.mint(NEXT_DAY);
    expect((await c.dailyRow(NEXT_DAY))?.quoteId).toBe(b);

    await c.react(c.ian, a, "down");

    // The replacement comes from the deck's high-water mark, so tomorrow's
    // card stands and today's steps past it.
    expect((await c.dailyRow(NEXT_DAY))?.quoteId).toBe(b);
    expect((await c.dailyRow(DAY))?.quoteId).toBe(cc);
  });

  test("what the club was shown that day survives the quote being pulled", async () => {
    const c = await club([0.1, 0.2, 0.3]);
    const [a] = c.quoteIds;
    await c.mint(DAY);
    const shown = (await c.seenBy(c.ian)) as { text: string };
    await c.mint(NEXT_DAY);

    // Yesterday's row is frozen: hiding the quote can't rewrite history.
    await c.react(c.ian, a, "down", NEXT_DAY);

    expect((await c.quote(a))?.hidden).toBe(true);
    expect(await c.seenBy(c.ian, DAY)).toMatchObject({ text: shown.text });
  });
});

describe("reaction bookkeeping", () => {
  test("one row per member, changeable and withdrawable", async () => {
    const c = await club([0.1, 0.2, 0.3]);
    const [a] = c.quoteIds;
    await c.mint(DAY);

    await c.react(c.peter, a, "up");
    await c.react(c.henry, a, "up");
    await c.react(c.ian, a, "up");
    expect(await c.seenBy(c.ian)).toMatchObject({
      up: 3,
      down: 0,
      myReaction: "up",
    });

    // Changing your mind rewrites your row rather than adding a second one,
    // and 1 👎 against 2 👍 is no veto.
    await c.react(c.ian, a, "down");
    expect(await c.seenBy(c.ian)).toMatchObject({
      up: 2,
      down: 1,
      myReaction: "down",
    });

    await c.react(c.ian, a, null);
    expect(await c.seenBy(c.ian)).toMatchObject({
      up: 2,
      down: 0,
      myReaction: null,
    });
    expect((await c.dailyRow(DAY))?.quoteId).toBe(a);
  });
});

describe("the admin paths that share the redeal", () => {
  test("rerollDailyQuote hides the dud and moves the day on", async () => {
    const c = await club([0.1, 0.2, 0.3]);
    const [a, b] = c.quoteIds;
    await c.mint(DAY);

    const result = await c.t.mutation(internal.setup.rerollDailyQuote, {
      clubId: c.clubId,
      day: DAY,
    });

    expect(result.hidQuote).toBe(true);
    expect((await c.quote(a))?.hidden).toBe(true);
    expect((await c.dailyRow(DAY))?.quoteId).toBe(b);
  });

  test("hideQuote undoes a veto", async () => {
    const c = await club([0.1, 0.2, 0.3]);
    const [a] = c.quoteIds;
    await c.mint(DAY);
    await c.react(c.ian, a, "down");

    await c.t.mutation(internal.setup.hideQuote, {
      quoteId: a,
      hidden: false,
    });

    // Back in the deck for a future pass — the 👎 against it still stands.
    expect((await c.quote(a))?.hidden).toBe(false);
    expect((await c.dailyRow(DAY))?.quoteId).not.toBe(a);
  });
});
