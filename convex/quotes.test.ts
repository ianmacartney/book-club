import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { mintDailyQuote, splitQuotes } from "./quotes";

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

// The seven-line passage the club spent 2026-09-11 looking at one line of.
const ODYSSEY = `To outwit you
in all your tricks, a person or a God
would need to be an expert at deceit.
You clever rascal! So duplicitous,
so talented at lying! You love fiction
and tricks so deeply, you refuse to stop
even in your own land.`;

describe("splitQuotes", () => {
  test("a passage broken over lines stays one quote", () => {
    expect(splitQuotes(ODYSSEY)).toEqual([
      "To outwit you in all your tricks, a person or a God would need to be " +
        "an expert at deceit. You clever rascal! So duplicitous, so talented " +
        "at lying! You love fiction and tricks so deeply, you refuse to stop " +
        "even in your own land.",
    ]);
  });

  test("a blank line always separates two pulls", () => {
    const raw = `The first line of one quote, long enough to keep.\n\nA second quote, also comfortably long enough.`;
    expect(splitQuotes(raw)).toHaveLength(2);
  });

  test("self-contained quoted lines are separate pulls", () => {
    const raw = `“My father once told me that respect for the truth comes close to being the beginning of all morality.”\n“How can you be responsible for your wounded? They are their own responsibility.”`;
    expect(splitQuotes(raw)).toHaveLength(2);
  });

  test("a quote mark left open holds the lines together", () => {
    // Opens on the first line, closes only on the last — one passage, even
    // though every line ends in punctuation and starts with a capital.
    const raw = `“When he saw the three men he stepped back and a look of disbelief came over him.\n"Who the hell are you?" he said at last.\nThe man in the center stepped forward.\n"My name is Shackleton," he replied in a quiet voice.\nAgain there was silence. Some said that Sorlle turned away and wept.”`;
    const out = splitQuotes(raw);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("My name is Shackleton");
    expect(out[0]).toContain("turned away and wept");
  });

  test("one block can hold a wrapped pull and separate ones", () => {
    // The trap in the middle: line 2 continues line 1, but lines 3 and 4 each
    // open their own. Deciding for the whole block either shatters the first
    // pull or swallows the other two — this has to be judged per break.
    const raw = `“The wise man is like a tree that bends instead of breaking in the wind.\nThings just are the way they are, no matter how you might wish otherwise.”\n“We push ourselves harder to get rid of anxiety, but the result is more of it.”\n“As you dive into life as it really is, you begin to acquire something rarer.”`;
    const out = splitQuotes(raw);
    expect(out).toHaveLength(3);
    expect(out[0]).toContain("bends instead of breaking");
    expect(out[0]).toContain("wish otherwise");
    expect(out[1]).toContain("push ourselves harder");
    expect(out[2]).toContain("dive into life");
  });

  test("bullets are their own pulls even when they run on", () => {
    const raw = `- the first bulleted line, which runs on\n- and here is the second bulleted pull`;
    const out = splitQuotes(raw);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe("the first bulleted line, which runs on");
  });

  test("fragments and whole essays both fall outside the band", () => {
    expect(splitQuotes("too short")).toEqual([]);
    expect(splitQuotes("x".repeat(1001))).toEqual([]);
    // The ceiling is generous enough for a genuinely long pull.
    expect(splitQuotes("x".repeat(900))).toHaveLength(1);
  });
});

describe("reindexQuotes", () => {
  /** A club with one submitted section whose quotes are `raw`. */
  async function shelf(raw: string) {
    const t = convexTest(schema, modules);
    const seed = await t.run(async (ctx) => {
      const ian = await ctx.db.insert("users", { name: "Ian M", timezone: TZ });
      const clubId = await ctx.db.insert("clubs", {
        name: "Push Up Club",
        createdBy: ian,
      });
      await ctx.db.insert("memberships", { clubId, userId: ian });
      await ctx.db.insert("checkins", { userId: ian, day: DAY, status: "star" });
      const bookId = await ctx.db.insert("books", {
        clubId,
        title: "The Odyssey",
        punishment: "karaoke",
        status: "active",
        rotation: [ian],
        startedDay: DAY,
      });
      const sectionId = await ctx.db.insert("sections", {
        bookId,
        index: 0,
        title: "Book 13",
        assignedTo: ian,
        submission: {
          by: ian,
          day: DAY,
          at: Date.now(),
          quotes: raw,
          thoughts: "t",
          skip: false,
        },
      });
      return { clubId, bookId, sectionId, ian };
    });
    return {
      t,
      ...seed,
      /** Index with the *old* line-per-quote behaviour, to repair from. */
      seedFragments: (texts: string[]) =>
        t.run(async (ctx) =>
          Promise.all(
            texts.map((text, i) =>
              ctx.db.insert("quotes", {
                clubId: seed.clubId,
                text,
                sort: (i + 1) / 10,
                hidden: false,
                sectionId: seed.sectionId,
                bookId: seed.bookId,
                submittedBy: seed.ian,
                submittedDay: DAY,
              }),
            ),
          ),
        ),
      reindex: (dryRun = false) =>
        t.mutation(internal.setup.reindexQuotes, {
          clubId: seed.clubId,
          dryRun,
        }),
      deck: () =>
        // eslint-disable-next-line @convex-dev/no-collect-in-query -- a fixture's whole table, a handful of rows
        t.run(async (ctx) => await ctx.db.query("quotes").collect()),
    };
  }

  const FRAGMENTS = ODYSSEY.split("\n").filter((l) => l.trim().length >= 20);

  test("shattered fragments are reconciled into the one passage", async () => {
    const s = await shelf(ODYSSEY);
    await s.seedFragments(FRAGMENTS);
    expect(await s.deck()).toHaveLength(FRAGMENTS.length);

    const result = await s.reindex();

    expect(result).toMatchObject({ added: 1, removed: FRAGMENTS.length });
    const deck = await s.deck();
    expect(deck).toHaveLength(1);
    expect(deck[0].text).toContain("even in your own land");
  });

  test("a dry run reports the change without making it", async () => {
    const s = await shelf(ODYSSEY);
    await s.seedFragments(FRAGMENTS);

    const result = await s.reindex(true);

    expect(result).toMatchObject({ added: 1, removed: FRAGMENTS.length });
    expect(await s.deck()).toHaveLength(FRAGMENTS.length);
  });

  test("a veto of a fragment doesn't follow the repaired passage", async () => {
    const s = await shelf(ODYSSEY);
    const ids = await s.seedFragments(FRAGMENTS);
    await s.t.run(async (ctx) => {
      await ctx.db.patch("quotes", ids[1], { hidden: true });
    });

    const result = await s.reindex();

    // Nobody vetoed the Odyssey; they vetoed being shown a sixth of a
    // sentence. The reassembled passage goes to the club unjudged.
    expect(result.vetoesDropped).toBe(1);
    const deck = await s.deck();
    expect(deck).toHaveLength(1);
    expect(deck[0].hidden).toBe(false);
  });

  test("a veto of a quote the splitter still produces is left alone", async () => {
    const raw = `“A first quote that stands entirely on its own.”\n“A second quote that also stands on its own.”`;
    const s = await shelf(raw);
    const ids = await s.seedFragments([
      "“A first quote that stands entirely on its own.”",
      "“A second quote that also stands on its own.”",
    ]);
    await s.t.run(async (ctx) => {
      await ctx.db.patch("quotes", ids[0], { hidden: true });
    });

    const result = await s.reindex();

    // That row is never deleted, so its verdict — a real one, on a real
    // quote — is never up for reconsideration.
    expect(result).toMatchObject({ vetoesDropped: 0, removed: 0 });
    const deck = await s.deck();
    expect(deck.find((q) => q._id === ids[0])?.hidden).toBe(true);
  });

  test("a day dealt a fragment is re-pointed, not left dangling", async () => {
    const s = await shelf(ODYSSEY);
    const ids = await s.seedFragments(FRAGMENTS);
    await s.t.run(async (ctx) => {
      await ctx.db.insert("dailyQuotes", {
        clubId: s.clubId,
        day: DAY,
        quoteId: ids[1],
        text: FRAGMENTS[1],
        sort: 0.2,
      });
      // A 👎 cast on the fragment that is about to stop existing.
      await ctx.db.insert("quoteReactions", {
        userId: s.ian,
        quoteId: ids[1],
        reaction: "down",
      });
    });

    const result = await s.reindex();

    expect(result).toMatchObject({ daysRepointed: 1, dislikesDropped: 1 });
    const deck = await s.deck();
    const day = await s.t.run(
      async (ctx) =>
        await ctx.db
          .query("dailyQuotes")
          .withIndex("clubDay", (q) => q.eq("clubId", s.clubId).eq("day", DAY))
          .unique(),
    );
    // Points at the repaired passage, so reacting still resolves…
    expect(day?.quoteId).toBe(deck[0]._id);
    // …but what the club was shown that day is untouched.
    expect(day?.text).toBe(FRAGMENTS[1]);
    // The 👎 went with the fragment: it does not ride onto the repaired
    // passage and trip the auto-veto against something nobody judged.
    expect(deck[0].hidden).toBe(false);
    const left = await s.t.run(async (ctx) =>
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- one quote's reactions in a fixture
      ctx.db
        .query("quoteReactions")
        .withIndex("quoteUser", (q) => q.eq("quoteId", deck[0]._id))
        .collect(),
    );
    expect(left).toEqual([]);
  });

  test("a 👍 follows the words it was cast on, once", async () => {
    const s = await shelf(ODYSSEY);
    const ids = await s.seedFragments(FRAGMENTS);
    const peter = await s.t.run(
      async (ctx) =>
        await ctx.db.insert("users", { name: "Peter", timezone: TZ }),
    );
    await s.t.run(async (ctx) => {
      // Ian liked two fragments that end up in the same passage; Peter one.
      for (const quoteId of [ids[1], ids[2]]) {
        await ctx.db.insert("quoteReactions", {
          userId: s.ian,
          quoteId,
          reaction: "up",
        });
      }
      await ctx.db.insert("quoteReactions", {
        userId: peter,
        quoteId: ids[3],
        reaction: "up",
      });
    });

    const result = await s.reindex();

    expect(result.likesMoved).toBe(3);
    const deck = await s.deck();
    const moved = await s.t.run(async (ctx) =>
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- one quote's reactions in a fixture
      ctx.db
        .query("quoteReactions")
        .withIndex("quoteUser", (q) => q.eq("quoteId", deck[0]._id))
        .collect(),
    );
    // Three likes, two members, one vote each on the passage.
    expect(moved).toHaveLength(2);
    expect(moved.every((r) => r.reaction === "up")).toBe(true);
    expect(new Set(moved.map((r) => r.userId))).toEqual(
      new Set([s.ian, peter]),
    );
  });

  test("rows the splitter still produces keep their place in the shuffle", async () => {
    const raw = `“A first quote that stands entirely on its own.”\n“A second quote that also stands on its own.”`;
    const s = await shelf(raw);
    const ids = await s.seedFragments([
      "“A first quote that stands entirely on its own.”",
      "“A second quote that also stands on its own.”",
    ]);

    const result = await s.reindex();

    // Nothing to do: identical rows, so they are not churned.
    expect(result).toMatchObject({ added: 0, removed: 0, scanned: 0 });
    const deck = await s.deck();
    expect(deck.map((q) => q._id).sort()).toEqual([...ids].sort());
    expect(deck.map((q) => q.sort).sort()).toEqual([0.1, 0.2]);
  });

  test("running it again is a no-op", async () => {
    const s = await shelf(ODYSSEY);
    await s.seedFragments(FRAGMENTS);
    await s.reindex();

    const second = await s.reindex();

    expect(second).toMatchObject({ scanned: 0, added: 0, removed: 0 });
    expect(await s.deck()).toHaveLength(1);
  });
});
