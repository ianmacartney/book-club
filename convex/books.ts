import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, mutation, query } from "./_generated/server";
import {
  clubMemberIds,
  clubRecipientIds,
  requireMembership,
  requireUser,
} from "./lib/access";
import { accrueLateClouds, tallyClouds } from "./lib/clouds";
import { addDays, diffDays, todayInTz, viewerDay } from "./lib/days";
import {
  notifyBookFinished,
  notifySectionSubmitted,
} from "./notifications";
import { indexSectionQuotes } from "./quotes";

export const DAYS_PER_SECTION = 2;

function nextInRotation(
  book: Doc<"books">,
  after: Id<"users">,
): Id<"users"> {
  const i = book.rotation.indexOf(after);
  return book.rotation[(i + 1) % book.rotation.length];
}

async function getActiveBook(
  ctx: MutationCtx,
  clubId: Id<"clubs">,
): Promise<Doc<"books"> | null> {
  return await ctx.db
    .query("books")
    .withIndex("clubStatus", (q) =>
      q.eq("clubId", clubId).eq("status", "active"),
    )
    .unique();
}

export async function startBookHelper(
  ctx: MutationCtx,
  args: {
    clubId: Id<"clubs">;
    title: string;
    author?: string;
    punishment: string;
    suggestedBy?: Id<"users">;
    sectionTitles: string[];
    rotation?: Id<"users">[];
    pollId?: Id<"polls">;
    // For backfilling a book that really started earlier (yyyy-MM-dd).
    startedDay?: string;
  },
): Promise<Id<"books">> {
  if (args.sectionTitles.length === 0) {
    throw new ConvexError("A book needs at least one section.");
  }
  if (await getActiveBook(ctx, args.clubId)) {
    throw new ConvexError("This club is already reading a book.");
  }
  const memberIds = await clubMemberIds(ctx, args.clubId);
  let rotation = args.rotation ?? memberIds;
  rotation = [...new Set(rotation)].filter((id) => memberIds.includes(id));
  if (rotation.length === 0) {
    throw new ConvexError("The reading rotation is empty.");
  }

  const firstReaderId = rotation[0];
  const firstReader = await ctx.db.get("users", firstReaderId);
  const startedDay = args.startedDay ?? todayInTz(firstReader?.timezone);

  const bookId = await ctx.db.insert("books", {
    clubId: args.clubId,
    title: args.title.trim(),
    author: args.author?.trim() || undefined,
    suggestedBy: args.suggestedBy,
    punishment: args.punishment,
    status: "active",
    rotation,
    startedDay,
    pollId: args.pollId,
  });
  // Sections are divvied up round-robin through the rotation, fixed up front.
  for (let i = 0; i < args.sectionTitles.length; i++) {
    await ctx.db.insert("sections", {
      bookId,
      index: i,
      title: args.sectionTitles[i].trim(),
      assignedTo: rotation[i % rotation.length],
      // The first reader's clock starts at the book start; later sections
      // get their due day when the previous section lands.
      dueDay:
        i === 0
          ? addDays(startedDay, DAYS_PER_SECTION)
          : undefined,
    });
  }
  return bookId;
}

export const start = mutation({
  args: {
    clubId: v.id("clubs"),
    title: v.string(),
    author: v.optional(v.string()),
    punishment: v.string(),
    sectionTitles: v.array(v.string()),
    rotation: v.optional(v.array(v.id("users"))),
  },
  returns: v.id("books"),
  handler: async (ctx, args) => {
    const user = await requireMembership(ctx, args.clubId);
    if (args.punishment.trim().length === 0) {
      throw new ConvexError(
        "The punishment is required — the suggester must set the stakes.",
      );
    }
    return await startBookHelper(ctx, {
      ...args,
      punishment: args.punishment.trim(),
      suggestedBy: user._id,
    });
  },
});

/**
 * Land a write-up on the book's current section: the submission itself, its
 * quotes into the club's deck, the next reader's clock, the push to the
 * club — and the book's final standings when that was the last section.
 *
 * Shared by the live submit and the release of a pre-written draft. The
 * historical backfill in setup.ts stays separate: it writes an explicit day
 * and deliberately sends nothing.
 */
async function recordSubmission(
  ctx: MutationCtx,
  args: {
    book: Doc<"books">;
    sections: Doc<"sections">[]; // the whole book, sorted by index
    section: Doc<"sections">;
    by: Doc<"users">;
    quotes: string;
    thoughts: string;
    isSkip: boolean;
    // When this came out of a draft: the moment it was written.
    draftedAt?: number;
    // Overrides the transaction clock. A released draft lands in the same
    // mutation as the submission that unblocked it, so `Date.now()` is
    // identical for both and the feed's tiebreak would sort them by name —
    // reading as though the draft came first. Nudging it forward keeps the
    // timeline causal.
    at?: number;
  },
): Promise<void> {
  const { book, sections, section, by } = args;
  const submittedDay = todayInTz(by.timezone);
  await ctx.db.patch("sections", section._id, {
    submission: {
      by: by._id,
      day: submittedDay,
      at: args.at ?? Date.now(),
      quotes: args.quotes,
      thoughts: args.thoughts,
      skip: args.isSkip,
      draftedAt: args.draftedAt,
    },
    // Whatever was held in reserve has now been spent.
    draft: undefined,
  });
  // Feed the lines into the club's quote deck, where they'll surface as a
  // quote of the day some random morning from here on.
  await indexSectionQuotes(ctx, {
    clubId: book.clubId,
    bookId: book._id,
    sectionId: section._id,
    submittedBy: by._id,
    submittedDay,
    raw: args.quotes,
  });

  // Ghosts hear about submissions too — they follow along, they just
  // don't owe anything.
  const memberIds = await clubRecipientIds(ctx, book.clubId);
  const next = sections.find((s) => s.index === section.index + 1);
  if (next !== undefined) {
    // The next reader's 2 calendar days start now, in their timezone.
    const nextReader = await ctx.db.get("users", next.assignedTo);
    const nextDueDay = addDays(
      todayInTz(nextReader?.timezone),
      DAYS_PER_SECTION,
    );
    await ctx.db.patch("sections", next._id, { dueDay: nextDueDay });
    const assignee = await ctx.db.get("users", section.assignedTo);
    await notifySectionSubmitted(ctx, {
      book,
      sectionTitle: section.title,
      by,
      assigneeName: assignee?.name ?? "the assignee",
      skip: args.isSkip,
      early: args.draftedAt !== undefined,
      thoughts: args.thoughts,
      memberIds,
      // "You're up" would be a lie if the next reader already wrote theirs:
      // their draft releases a moment from now, so they hear the ordinary
      // submission news instead.
      next: hasLiveDraft(next)
        ? null
        : {
            assigneeId: next.assignedTo,
            title: next.title,
            dueDay: nextDueDay,
          },
    });
  } else {
    await finishBook(ctx, book);
    const finished = await ctx.db.get("books", book._id);
    const loserNames = await Promise.all(
      (finished?.result?.loserIds ?? []).map(async (id) => {
        const u = await ctx.db.get("users", id);
        return u?.name ?? "?";
      }),
    );
    await notifyBookFinished(ctx, {
      book,
      memberIds,
      byId: by._id,
      loserNames,
    });
  }
}

/** A draft that is still the assignee's own, and so still releasable. */
function hasLiveDraft(section: Doc<"sections">): boolean {
  return (
    section.draft !== undefined && section.draft.by === section.assignedTo
  );
}

/**
 * Post any write-ups that were prepared in advance and have now come up.
 * Called the instant a section lands — so a pre-written next section goes
 * out behind it, and a whole chain of them unspools in one go — and again
 * from the hourly cron as a backstop.
 */
export async function releaseDrafts(
  ctx: MutationCtx,
  bookId: Id<"books">,
): Promise<void> {
  // Each lap lands one section, so the book itself bounds the chain.
  for (let lap = 0; ; lap++) {
    const book = await ctx.db.get("books", bookId);
    if (book === null || book.status !== "active") {
      return;
    }
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- one book's sections — bounded (<1000/book, dozens in practice)
    const sections = await ctx.db
      .query("sections")
      .withIndex("bookIdx", (q) => q.eq("bookId", book._id))
      .collect();
    sections.sort((a, b) => a.index - b.index);
    if (lap > sections.length) {
      return; // can't happen; a guard against ever looping forever
    }
    const current = sections.find((s) => s.submission === undefined);
    if (current === undefined || current.draft === undefined) {
      return;
    }
    const draft = current.draft;
    const by = await ctx.db.get("users", draft.by);
    // The rotation is fixed at the book's start, so a draft can only fall
    // out of step with its section if its author left. Drop it rather than
    // post it under someone else's turn.
    if (by === null || !hasLiveDraft(current)) {
      await ctx.db.patch("sections", current._id, { draft: undefined });
      return;
    }
    // Normally nothing: the draft releases the moment the section comes up,
    // before a due day has had a chance to lapse. The cron backstop can
    // find one that has been sitting, and that lateness is real.
    await accrueLateClouds(ctx, book, current, todayInTz(by.timezone));
    await recordSubmission(ctx, {
      book,
      sections,
      section: current,
      by,
      quotes: draft.quotes,
      thoughts: draft.thoughts,
      isSkip: false,
      draftedAt: draft.at,
      at: Date.now() + lap + 1,
    });
  }
}

/**
 * Submit quotes + thoughts for the current section. Two cases:
 *  - it's your section: always allowed (late days are billed by the cron);
 *  - it's someone else's *overdue* section and you're next in line: a
 *    "skip" — they eat 2 extra clouds and the book moves on.
 */
export const submitSection = mutation({
  args: {
    sectionId: v.id("sections"),
    quotes: v.string(),
    thoughts: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const section = await ctx.db.get("sections", args.sectionId);
    if (section === null) {
      throw new ConvexError("Section not found.");
    }
    const book = await ctx.db.get("books", section.bookId);
    if (book === null || book.status !== "active") {
      throw new ConvexError("This book isn't being read right now.");
    }
    await requireMembership(ctx, book.clubId);

    // eslint-disable-next-line @convex-dev/no-collect-in-query -- one book's sections — bounded (<1000/book, dozens in practice)
    const sections = await ctx.db
      .query("sections")
      .withIndex("bookIdx", (q) => q.eq("bookId", book._id))
      .collect();
    sections.sort((a, b) => a.index - b.index);
    const current = sections.find((s) => s.submission === undefined);
    if (current === undefined || current._id !== section._id) {
      throw new ConvexError("It isn't this section's turn.");
    }

    const assignee = await ctx.db.get("users", section.assignedTo);
    const assigneeToday = todayInTz(assignee?.timezone);
    // Settle any late days the hourly cron hasn't billed yet — otherwise a
    // submission early in a fresh late day would erase it forever.
    await accrueLateClouds(ctx, book, section, assigneeToday);
    const isSkip = section.assignedTo !== user._id;
    if (isSkip) {
      const overdue =
        section.dueDay !== undefined && assigneeToday > section.dueDay;
      if (!overdue) {
        throw new ConvexError(
          "You can only cover someone's section once it's past due.",
        );
      }
      if (user._id !== nextInRotation(book, section.assignedTo)) {
        throw new ConvexError(
          "Only the next reader in the rotation can cover an overdue section.",
        );
      }
      // The extra two clouds for getting skipped, on top of the late days.
      await ctx.db.insert("clouds", {
        userId: section.assignedTo,
        day: assigneeToday,
        count: 2,
        source: "section_skip",
        clubId: book.clubId,
        bookId: book._id,
        sectionId: section._id,
      });
    }

    await recordSubmission(ctx, {
      book,
      sections,
      section,
      by: user,
      quotes: args.quotes,
      thoughts: args.thoughts,
      isSkip,
    });
    // Whoever is up next may have written theirs already.
    await releaseDrafts(ctx, book._id);
    return null;
  },
});

/**
 * Write up one of your own sections before its turn comes round. The draft
 * sits on the section until the book reaches it, then posts itself — so a
 * member who reads ahead, or who'll be off the grid when they're up, can
 * bank the write-up now.
 *
 * Saving over an existing draft replaces it. If the section turns out to be
 * current already — you read ahead and the book caught up, or the previous
 * reader landed theirs while you were typing — there's nothing to wait for,
 * so it submits on the spot and says so.
 */
export const saveDraft = mutation({
  args: {
    sectionId: v.id("sections"),
    quotes: v.string(),
    thoughts: v.string(),
  },
  returns: v.union(v.literal("saved"), v.literal("submitted")),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const section = await ctx.db.get("sections", args.sectionId);
    if (section === null) {
      throw new ConvexError("Section not found.");
    }
    const book = await ctx.db.get("books", section.bookId);
    if (book === null || book.status !== "active") {
      throw new ConvexError("This book isn't being read right now.");
    }
    await requireMembership(ctx, book.clubId);
    if (section.submission !== undefined) {
      throw new ConvexError("This section has already been written up.");
    }
    if (section.assignedTo !== user._id) {
      throw new ConvexError("You can only write ahead on your own sections.");
    }
    const quotes = args.quotes.trim();
    const thoughts = args.thoughts.trim();
    if (quotes.length === 0 && thoughts.length === 0) {
      throw new ConvexError("Leave something for the club to read.");
    }

    // eslint-disable-next-line @convex-dev/no-collect-in-query -- one book's sections — bounded (<1000/book, dozens in practice)
    const sections = await ctx.db
      .query("sections")
      .withIndex("bookIdx", (q) => q.eq("bookId", book._id))
      .collect();
    sections.sort((a, b) => a.index - b.index);
    const current = sections.find((s) => s.submission === undefined);
    if (current !== undefined && current._id === section._id) {
      await accrueLateClouds(ctx, book, section, todayInTz(user.timezone));
      await recordSubmission(ctx, {
        book,
        sections,
        section,
        by: user,
        quotes,
        thoughts,
        isSkip: false,
      });
      await releaseDrafts(ctx, book._id);
      return "submitted";
    }

    await ctx.db.patch("sections", section._id, {
      draft: { by: user._id, at: Date.now(), quotes, thoughts },
    });
    return "saved";
  },
});

/** Take back a write-up you'd banked, so nothing posts on your behalf. */
export const discardDraft = mutation({
  args: { sectionId: v.id("sections") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const section = await ctx.db.get("sections", args.sectionId);
    if (section === null) {
      throw new ConvexError("Section not found.");
    }
    const book = await ctx.db.get("books", section.bookId);
    if (book === null) {
      throw new ConvexError("Book not found.");
    }
    await requireMembership(ctx, book.clubId);
    if (section.draft === undefined) {
      return null; // already gone — nothing to take back
    }
    if (section.draft.by !== user._id) {
      throw new ConvexError("That draft isn't yours.");
    }
    await ctx.db.patch("sections", section._id, { draft: undefined });
    return null;
  },
});

/**
 * The last section landed: tally clouds and crown the loser(s). The stored
 * result is the authoritative final standing — `endedDay` is informational
 * (members' local days straddle it), so nothing recomputes from it.
 */
export async function finishBook(ctx: MutationCtx, book: Doc<"books">) {
  const endedDay = todayInTz(undefined);
  const tallies = await tallyClouds(
    ctx,
    book.rotation,
    book.clubId,
    book.startedDay,
  );
  const worst = Math.max(...tallies.map((t) => t.clouds));
  const loserIds = tallies
    .filter((t) => t.clouds === worst && worst > 0)
    .map((t) => t.userId);
  await ctx.db.patch("books", book._id, {
    status: "finished",
    endedDay,
    result: { tallies, loserIds },
  });
}

export const abandon = mutation({
  args: { bookId: v.id("books") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const book = await ctx.db.get("books", args.bookId);
    if (book === null) {
      throw new ConvexError("Book not found.");
    }
    await requireMembership(ctx, book.clubId);
    if (book.status !== "active") {
      throw new ConvexError("This book isn't active.");
    }
    await ctx.db.patch("books", book._id, {
      status: "abandoned",
      endedDay: todayInTz(undefined),
    });
    return null;
  },
});

/** Full detail for the book page: sections, submissions, standings. */
export const detail = query({
  // `daysLate` on the current section ticks over at the assignee's midnight.
  args: { bookId: v.id("books"), viewerDay },
  handler: async (ctx, args) => {
    const book = await ctx.db.get("books", args.bookId);
    if (book === null) {
      throw new ConvexError("Book not found.");
    }
    const viewer = await requireMembership(ctx, book.clubId);

    // eslint-disable-next-line @convex-dev/no-collect-in-query -- one book's sections — bounded (<1000/book, dozens in practice)
    const sections = await ctx.db
      .query("sections")
      .withIndex("bookIdx", (q) => q.eq("bookId", book._id))
      .collect();
    sections.sort((a, b) => a.index - b.index);
    const current = sections.find((s) => s.submission === undefined);

    const userIds = new Set<Id<"users">>(book.rotation);
    sections.forEach((s) => {
      userIds.add(s.assignedTo);
      if (s.submission) userIds.add(s.submission.by);
    });
    if (book.suggestedBy !== undefined) userIds.add(book.suggestedBy);
    const names = new Map<Id<"users">, string>();
    for (const userId of userIds) {
      const u = await ctx.db.get("users", userId);
      names.set(userId, u?.name ?? "former member");
    }

    let currentInfo = null;
    if (current !== undefined) {
      const assignee = await ctx.db.get("users", current.assignedTo);
      const assigneeToday = todayInTz(assignee?.timezone);
      const daysLate = current.dueDay
        ? Math.max(0, diffDays(assigneeToday, current.dueDay))
        : 0;
      currentInfo = {
        sectionId: current._id,
        daysLate,
        // Who's allowed to cover it if it's overdue.
        skipperId: nextInRotation(book, current.assignedTo),
      };
    }

    // Finished books show the frozen result; only live books recompute.
    // Imported historical books may lack a result — bound their fallback by
    // endedDay so they don't absorb clouds from later eras.
    const tallies =
      book.result?.tallies ??
      (await tallyClouds(
        ctx,
        book.rotation,
        book.clubId,
        book.startedDay,
        book.status === "finished" ? book.endedDay : undefined,
      ));

    return {
      book: {
        _id: book._id,
        title: book.title,
        author: book.author ?? null,
        punishment: book.punishment,
        status: book.status,
        startedDay: book.startedDay,
        endedDay: book.endedDay ?? null,
        suggestedBy:
          (book.suggestedBy && names.get(book.suggestedBy)) ?? null,
        result: book.result ?? null,
      },
      viewerId: viewer._id,
      current: currentInfo,
      sections: sections.map((s) => ({
        _id: s._id,
        index: s.index,
        title: s.title,
        assignedTo: s.assignedTo,
        assigneeName: names.get(s.assignedTo) ?? "?",
        dueDay: s.dueDay ?? null,
        submission: s.submission
          ? { ...s.submission, byName: names.get(s.submission.by) ?? "?" }
          : null,
        // That a section is written ahead is club news — no spoilers in it.
        // The words themselves stay with whoever wrote them until it posts.
        draft:
          s.draft === undefined
            ? null
            : {
                at: s.draft.at,
                mine: s.draft.by === viewer._id,
                quotes: s.draft.by === viewer._id ? s.draft.quotes : null,
                thoughts: s.draft.by === viewer._id ? s.draft.thoughts : null,
              },
      })),
      standings: tallies
        .map((t) => ({ ...t, name: names.get(t.userId) ?? "?" }))
        .sort((a, b) => b.clouds - a.clouds),
    };
  },
});

/** Finished/abandoned books for the club's history view. */
export const history = query({
  args: { clubId: v.id("clubs") },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.clubId);
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- a club's books — bounded (<1000)
    const finished = await ctx.db
      .query("books")
      .withIndex("clubStatus", (q) =>
        q.eq("clubId", args.clubId).eq("status", "finished"),
      )
      .collect();
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- a club's books — bounded (<1000)
    const abandoned = await ctx.db
      .query("books")
      .withIndex("clubStatus", (q) =>
        q.eq("clubId", args.clubId).eq("status", "abandoned"),
      )
      .collect();
    const all = [...finished, ...abandoned].sort((a, b) =>
      (b.endedDay ?? "").localeCompare(a.endedDay ?? ""),
    );
    return Promise.all(
      all.map(async (book) => {
        const loserNames = await Promise.all(
          (book.result?.loserIds ?? []).map(async (id) => {
            const u = await ctx.db.get("users", id);
            return u?.name ?? "?";
          }),
        );
        return {
          _id: book._id,
          title: book.title,
          author: book.author ?? null,
          status: book.status,
          startedDay: book.startedDay,
          endedDay: book.endedDay ?? null,
          punishment: book.punishment,
          loserNames,
        };
      }),
    );
  },
});
