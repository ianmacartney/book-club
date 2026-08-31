import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { startBookHelper } from "./books";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const TZ = "America/Los_Angeles";
// Long enough to clear MIN_QUOTE_CHARS, so released write-ups reach the deck.
const QUOTE = "A line somebody pulled out of a book, kept for later.";

/**
 * Three members, one active book of four sections. The rotation is
 * [ava, bo, cy], so the sections belong to ava, bo, cy, ava in turn.
 */
async function reading() {
  const t = convexTest(schema, modules);
  const seed = await t.run(async (ctx) => {
    const ava = await ctx.db.insert("users", { name: "Ava", timezone: TZ });
    const bo = await ctx.db.insert("users", { name: "Bo", timezone: TZ });
    const cy = await ctx.db.insert("users", { name: "Cy", timezone: TZ });
    const clubId = await ctx.db.insert("clubs", {
      name: "Push Up Club",
      createdBy: ava,
    });
    for (const userId of [ava, bo, cy]) {
      await ctx.db.insert("memberships", { clubId, userId });
    }
    const bookId = await startBookHelper(ctx, {
      clubId,
      title: "The Odyssey",
      punishment: "karaoke",
      sectionTitles: ["One", "Two", "Three", "Four"],
      rotation: [ava, bo, cy],
    });
    return { clubId, bookId, ava, bo, cy };
  });

  const sectionIds = await t.run(async (ctx) => {
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- a fixture's whole table, a handful of rows
    const rows = await ctx.db
      .query("sections")
      .withIndex("bookIdx", (q) => q.eq("bookId", seed.bookId))
      .collect();
    rows.sort((a, b) => a.index - b.index);
    return rows.map((s) => s._id);
  });

  return {
    t,
    ...seed,
    sectionIds,
    as: (userId: Id<"users">) => t.withIdentity({ subject: userId }),
    sections: (): Promise<Doc<"sections">[]> =>
      t.run(async (ctx) => {
        // eslint-disable-next-line @convex-dev/no-collect-in-query -- a fixture's whole table, a handful of rows
        const rows = await ctx.db
          .query("sections")
          .withIndex("bookIdx", (q) => q.eq("bookId", seed.bookId))
          .collect();
        return rows.sort((a, b) => a.index - b.index);
      }),
    book: (): Promise<Doc<"books"> | null> =>
      t.run(async (ctx) => await ctx.db.get("books", seed.bookId)),
    clouds: (): Promise<Doc<"clouds">[]> =>
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- a fixture's whole table, a handful of rows
      t.run(async (ctx) => await ctx.db.query("clouds").collect()),
    deck: (): Promise<string[]> =>
      t.run(async (ctx) => {
        // eslint-disable-next-line @convex-dev/no-collect-in-query -- a fixture's whole table, a handful of rows
        const rows = await ctx.db.query("quotes").collect();
        return rows.map((q) => q.text);
      }),
  };
}

describe("write-ahead drafts", () => {
  test("a draft on a future section is held, not posted", async () => {
    const r = await reading();
    const result = await r.as(r.bo).mutation(api.books.saveDraft, {
      sectionId: r.sectionIds[1],
      quotes: QUOTE,
      thoughts: "bo's thoughts",
    });

    expect(result).toBe("saved");
    const [one, two] = await r.sections();
    expect(two.draft?.quotes).toBe(QUOTE);
    expect(two.submission).toBeUndefined();
    // The book hasn't moved: section one is still the one that's up.
    expect(one.submission).toBeUndefined();
    // And nothing reaches the deck until it actually posts.
    expect(await r.deck()).toEqual([]);
  });

  test("the draft posts itself the moment its turn comes round", async () => {
    const r = await reading();
    await r.as(r.bo).mutation(api.books.saveDraft, {
      sectionId: r.sectionIds[1],
      quotes: QUOTE,
      thoughts: "bo's thoughts",
    });
    await r.as(r.ava).mutation(api.books.submitSection, {
      sectionId: r.sectionIds[0],
      quotes: QUOTE,
      thoughts: "ava's thoughts",
    });

    const [one, two, three] = await r.sections();
    expect(one.submission?.by).toBe(r.ava);
    expect(two.submission?.by).toBe(r.bo);
    expect(two.submission?.thoughts).toBe("bo's thoughts");
    // Marked as banked rather than typed on the spot, and spent.
    expect(two.submission?.draftedAt).toEqual(expect.any(Number));
    expect(two.draft).toBeUndefined();
    // The release chained the clock on to the next reader.
    expect(three.dueDay).not.toBeNull();
    expect(three.submission).toBeUndefined();
  });

  test("a released draft sorts after the submission that freed it", async () => {
    const r = await reading();
    await r.as(r.bo).mutation(api.books.saveDraft, {
      sectionId: r.sectionIds[1],
      quotes: QUOTE,
      thoughts: "bo's thoughts",
    });
    // Convex freezes Date.now() for a whole transaction; convex-test doesn't,
    // so pin it by hand — otherwise the real clock ticking between the two
    // writes hides the very collision this guards against.
    const frozen = vi.spyOn(Date, "now").mockReturnValue(1_788_000_000_000);
    try {
      await r.as(r.ava).mutation(api.books.submitSection, {
        sectionId: r.sectionIds[0],
        quotes: QUOTE,
        thoughts: "ava's thoughts",
      });
    } finally {
      frozen.mockRestore();
    }

    const [one, two] = await r.sections();
    // Same transaction, same clock: only the nudge separates them, and the
    // feed's name tiebreak would otherwise read Bo as having gone first.
    expect(two.submission!.at).toBeGreaterThan(one.submission!.at);
  });

  test("a run of pre-written sections unspools in one go", async () => {
    const r = await reading();
    for (const [i, who] of [
      [1, r.bo],
      [2, r.cy],
      [3, r.ava],
    ] as const) {
      await r.as(who).mutation(api.books.saveDraft, {
        sectionId: r.sectionIds[i],
        quotes: QUOTE,
        thoughts: `thoughts ${i}`,
      });
    }
    const frozen = vi.spyOn(Date, "now").mockReturnValue(1_788_000_000_000);
    try {
      await r.as(r.ava).mutation(api.books.submitSection, {
        sectionId: r.sectionIds[0],
        quotes: QUOTE,
        thoughts: "ava's thoughts",
      });
    } finally {
      frozen.mockRestore();
    }

    const sections = await r.sections();
    expect(sections.map((s) => s.submission?.by)).toEqual([
      r.ava,
      r.bo,
      r.cy,
      r.ava,
    ]);
    // Causal order holds the whole way down the chain — on one frozen clock,
    // so this is the nudge and not the wall clock happening to tick.
    const ats = sections.map((s) => s.submission!.at);
    expect(ats).toEqual([...ats].sort((a, b) => a - b));
    expect(new Set(ats).size).toBe(4);
    // A chain that reaches the last section finishes the book.
    const book = await r.book();
    expect(book?.status).toBe("finished");
    expect(book?.result).not.toBeNull();
    // On time throughout, so nobody owes anything for it.
    expect(await r.clouds()).toEqual([]);
  });

  test("the hourly cron releases a draft that was left stranded", async () => {
    const r = await reading();
    // Stand in for a release that never fired: a draft on the section that
    // is already up, which saveDraft would have posted on the spot.
    await r.t.run(async (ctx) => {
      await ctx.db.patch("sections", r.sectionIds[0], {
        draft: { by: r.ava, at: Date.now(), quotes: QUOTE, thoughts: "t" },
      });
    });

    await r.t.mutation(internal.rollover.processAll, {});

    const [one, two] = await r.sections();
    expect(one.submission?.draftedAt).toEqual(expect.any(Number));
    expect(one.draft).toBeUndefined();
    expect(two.dueDay).not.toBeNull();
  });

  test("saving against the section that is already up posts it instead", async () => {
    const r = await reading();
    const result = await r.as(r.ava).mutation(api.books.saveDraft, {
      sectionId: r.sectionIds[0],
      quotes: QUOTE,
      thoughts: "ava's thoughts",
    });

    expect(result).toBe("submitted");
    const [one] = await r.sections();
    expect(one.submission?.by).toBe(r.ava);
    // Typed just now, so it isn't dressed up as having been written ahead.
    expect(one.submission?.draftedAt).toBeUndefined();
    expect(await r.deck()).toEqual([QUOTE]);
  });

  test("only the assignee can write a section ahead", async () => {
    const r = await reading();
    await expect(
      r.as(r.bo).mutation(api.books.saveDraft, {
        sectionId: r.sectionIds[2], // Cy's
        quotes: QUOTE,
        thoughts: "t",
      }),
    ).rejects.toThrow("your own sections");
  });

  test("an empty draft is refused, so nothing blank can post itself", async () => {
    const r = await reading();
    await expect(
      r.as(r.bo).mutation(api.books.saveDraft, {
        sectionId: r.sectionIds[1],
        quotes: "   ",
        thoughts: "",
      }),
    ).rejects.toThrow("Leave something");
  });

  test("a draft can be taken back, and only by its author", async () => {
    const r = await reading();
    await r.as(r.bo).mutation(api.books.saveDraft, {
      sectionId: r.sectionIds[1],
      quotes: QUOTE,
      thoughts: "bo's thoughts",
    });

    await expect(
      r.as(r.cy).mutation(api.books.discardDraft, {
        sectionId: r.sectionIds[1],
      }),
    ).rejects.toThrow("isn't yours");

    await r.as(r.bo).mutation(api.books.discardDraft, {
      sectionId: r.sectionIds[1],
    });
    expect((await r.sections())[1].draft).toBeUndefined();

    // Taken back means taken back: the turn comes round to nothing.
    await r.as(r.ava).mutation(api.books.submitSection, {
      sectionId: r.sectionIds[0],
      quotes: QUOTE,
      thoughts: "ava's thoughts",
    });
    expect((await r.sections())[1].submission).toBeUndefined();
  });

  test("the club sees that a section is ready, but not what it says", async () => {
    const r = await reading();
    await r.as(r.bo).mutation(api.books.saveDraft, {
      sectionId: r.sectionIds[1],
      quotes: QUOTE,
      thoughts: "bo's thoughts",
    });

    const mine = await r.as(r.bo).query(api.books.detail, { bookId: r.bookId });
    expect(mine.sections[1].draft).toMatchObject({
      mine: true,
      quotes: QUOTE,
      thoughts: "bo's thoughts",
    });

    const theirs = await r
      .as(r.cy)
      .query(api.books.detail, { bookId: r.bookId });
    expect(theirs.sections[1].draft).toMatchObject({
      mine: false,
      quotes: null,
      thoughts: null,
    });
  });
});
