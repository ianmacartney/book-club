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

    await ctx.db.patch("sections", section._id, {
      submission: {
        by: user._id,
        day: todayInTz(user.timezone),
        at: Date.now(),
        quotes: args.quotes,
        thoughts: args.thoughts,
        skip: isSkip,
      },
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
      await notifySectionSubmitted(ctx, {
        book,
        sectionTitle: section.title,
        by: user,
        assigneeName:
          assignee?.name ?? assignee?.username ?? "the assignee",
        skip: isSkip,
        thoughts: args.thoughts,
        memberIds,
        next: {
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
          return u?.name ?? u?.username ?? "?";
        }),
      );
      await notifyBookFinished(ctx, {
        book,
        memberIds,
        byId: user._id,
        loserNames,
      });
    }
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
      names.set(userId, u?.name ?? u?.username ?? "former member");
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
            return u?.name ?? u?.username ?? "?";
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
