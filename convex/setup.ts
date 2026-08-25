import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, internalMutation } from "./_generated/server";
import { DAYS_PER_SECTION, finishBook, startBookHelper } from "./books";
import { clubMemberships } from "./lib/access";
import { accrueLateClouds } from "./lib/clouds";
import { addDays, diffDays, isValidDay, todayInTz } from "./lib/days";
import {
  MAX_OFF_GRID_DAYS,
  overlappingPeriods,
  settleOffGridDays,
} from "./lib/offgrid";
import { indexSectionQuotes, mintDailyQuote } from "./quotes";
import { checkinStatus } from "./schema";

/**
 * Admin one-shots for `npx convex run`. These bypass the normal turn/day
 * guards so real-world history (e.g. from the club's iMessage thread) can
 * be recorded after the fact, with explicit days.
 */

async function memberByName(
  ctx: MutationCtx,
  clubId: Id<"clubs">,
  name: string,
  // Historical imports may reference ex-members (ghost users, no membership).
  includeGhosts = false,
): Promise<Doc<"users">> {
  const memberships = await clubMemberships(ctx, clubId);
  const memberIds = memberships
    .filter((m) => !includeGhosts || m.role !== "ghost")
    .map((m) => m.userId);
  const pool = (
    await Promise.all(memberIds.map((id) => ctx.db.get("users", id)))
  ).filter((m) => m !== null);
  const needle = name.trim().toLowerCase();
  const found = pool.filter((m) => (m.name ?? "").toLowerCase() === needle);
  if (found.length !== 1) {
    throw new ConvexError(
      `${found.length === 0 ? "No" : "Multiple"} users match "${name}". ` +
        `Candidates: ` +
        pool.map((m) => `${m.name ?? "?"} (@${m.username})`).join(", "),
    );
  }
  return found[0];
}

/**
 * Set a member's role: "ghost" watches the club (feed, library, standings)
 * without obligations — no pushups, no reminders, no place in the rotation;
 * "member" restores full standing. Creates the membership if the user has
 * none (the path for giving an ex-member like Tucker read access), but note
 * the rollover only bills full members from their membership's creation
 * time, so a later ghost→member flip starts their clock then.
 */
export const setMemberRole = internalMutation({
  args: {
    clubId: v.id("clubs"),
    userName: v.string(),
    role: v.union(v.literal("member"), v.literal("ghost")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await memberByName(ctx, args.clubId, args.userName, true);
    const existing = await ctx.db
      .query("memberships")
      .withIndex("clubUser", (q) =>
        q.eq("clubId", args.clubId).eq("userId", user._id),
      )
      .unique();
    const role = args.role === "member" ? undefined : args.role;
    if (existing === null) {
      await ctx.db.insert("memberships", {
        clubId: args.clubId,
        userId: user._id,
        role,
      });
    } else {
      await ctx.db.patch("memberships", existing._id, { role });
    }
    return null;
  },
});

/**
 * Change a member's login username. Ex-members imported as ghosts get
 * scaffolding usernames (`tucker-ghost`); this makes the name they actually
 * type to sign in a human one.
 *
 * `users.username` is not the login credential itself — the auth account is —
 * but it's what a new sign-up matches on to claim an existing row, and what
 * `memberByName` resolves admin commands against, so it has to stay unique
 * across both `username` and `name`.
 *
 * For a member who already has an account, the word they type at sign-in lives
 * in the `authUsername` component, so the rename is pushed there too. An
 * account-less row (the imported roster) has nothing to push: renaming it just
 * changes which sign-up can claim it.
 */
export const renameUsername = internalMutation({
  args: {
    clubId: v.id("clubs"),
    userName: v.string(),
    newUsername: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const user = await memberByName(ctx, args.clubId, args.userName, true);
    const next = args.newUsername.trim();
    if (next.length === 0) {
      throw new ConvexError("Username can't be empty.");
    }

    const result = await ctx.runMutation(
      components.authUsername.public.setUsername,
      {
        userId: user._id,
        username: args.newUsername,
      },
    );
    if (!result.success) {
      throw new ConvexError(result.userError);
    }

    const before = user.username;
    await ctx.db.patch("users", user._id, { username: next });

    return `Renamed ${user.name ?? "?"}: @${before} → @${next}`;
  },
});

/**
 * Start a book with an explicit rotation and suggester, matched by display
 * name or username — the in-app form only does join-order rotation and
 * credits the caller as suggester. `startedDay` backdates the start.
 */
export const startBookAsAdmin = internalMutation({
  args: {
    clubId: v.id("clubs"),
    title: v.string(),
    author: v.optional(v.string()),
    punishment: v.string(),
    suggestedByName: v.string(),
    rotationNames: v.array(v.string()),
    sectionTitles: v.array(v.string()),
    startedDay: v.optional(v.string()),
  },
  returns: v.id("books"),
  handler: async (ctx, args) => {
    const rotation = [];
    for (const name of args.rotationNames) {
      rotation.push((await memberByName(ctx, args.clubId, name))._id);
    }
    return await startBookHelper(ctx, {
      clubId: args.clubId,
      title: args.title,
      author: args.author,
      punishment: args.punishment,
      suggestedBy: (await memberByName(ctx, args.clubId, args.suggestedByName))
        ._id,
      rotation,
      sectionTitles: args.sectionTitles,
      startedDay: args.startedDay,
    });
  },
});

/**
 * Record a historical submission for the next unsubmitted section. Mirrors
 * submitSection but with an explicit day: bills late days up to that day,
 * charges the skip penalty if someone else covered it, chains the next
 * section's due day from it, and finishes the book on the last one. Also
 * deletes any spurious late clouds the cron billed after the real
 * submission day (it couldn't know before the backfill).
 */
export const backfillSubmission = internalMutation({
  args: {
    bookId: v.id("books"),
    sectionIndex: v.number(),
    byName: v.string(),
    day: v.string(), // yyyy-MM-dd, the submitter's local day it happened
    quotes: v.optional(v.string()),
    thoughts: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const book = await ctx.db.get("books", args.bookId);
    if (book === null || book.status !== "active") {
      throw new ConvexError("Book not found or not active.");
    }
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- one book's sections — bounded (<1000/book, dozens in practice)
    const sections = await ctx.db
      .query("sections")
      .withIndex("bookIdx", (q) => q.eq("bookId", book._id))
      .collect();
    sections.sort((a, b) => a.index - b.index);
    const current = sections.find((s) => s.submission === undefined);
    if (current === undefined || current.index !== args.sectionIndex) {
      throw new ConvexError(
        `Sections must be backfilled in order; next unsubmitted index is ` +
          `${current?.index ?? "none — book is done"}.`,
      );
    }
    const by = await memberByName(ctx, book.clubId, args.byName);

    // Settle lateness as of the real submission day, then drop anything the
    // cron billed for days after it.
    await accrueLateClouds(ctx, book, current, args.day);
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- one section's clouds — bounded
    const billed = await ctx.db
      .query("clouds")
      .withIndex("sectionDay", (q) =>
        q.eq("sectionId", current._id).gt("day", args.day),
      )
      .collect();
    for (const entry of billed) {
      await ctx.db.delete("clouds", entry._id);
    }

    const isSkip = by._id !== current.assignedTo;
    if (isSkip) {
      await ctx.db.insert("clouds", {
        userId: current.assignedTo,
        day: args.day,
        count: 2,
        source: "section_skip",
        clubId: book.clubId,
        bookId: book._id,
        sectionId: current._id,
      });
    }
    await ctx.db.patch("sections", current._id, {
      submission: {
        by: by._id,
        day: args.day,
        at: Date.parse(`${args.day}T12:00:00Z`),
        quotes: args.quotes ?? "",
        thoughts: args.thoughts ?? "(backfilled from the group chat)",
        skip: isSkip,
      },
    });
    await indexSectionQuotes(ctx, {
      clubId: book.clubId,
      bookId: book._id,
      sectionId: current._id,
      submittedBy: by._id,
      submittedDay: args.day,
      raw: args.quotes ?? "",
    });

    const next = sections.find((s) => s.index === current.index + 1);
    if (next !== undefined) {
      await ctx.db.patch("sections", next._id, {
        dueDay: addDays(args.day, DAYS_PER_SECTION),
      });
    } else {
      await finishBook(ctx, book);
    }
    return null;
  },
});

/**
 * Import a whole finished book from the club's chat archive in one call:
 * the book row, one section per parsed submission (assigned to whoever
 * actually submitted), and the official final tally when the chat recorded
 * one. No cloud ledger entries — historical lateness is already baked into
 * the official tallies. Idempotent on (clubId, title, startedDay).
 */
export const importPastBook = internalMutation({
  args: {
    clubId: v.id("clubs"),
    title: v.string(),
    author: v.optional(v.string()),
    punishment: v.optional(v.string()),
    suggestedByName: v.optional(v.string()),
    startedDay: v.string(),
    endedDay: v.string(),
    rotationNames: v.array(v.string()),
    sections: v.array(
      v.object({
        title: v.string(),
        byName: v.string(),
        day: v.string(),
        quotes: v.optional(v.string()),
        thoughts: v.optional(v.string()),
      }),
    ),
    resultTallies: v.optional(
      v.array(v.object({ name: v.string(), clouds: v.number() })),
    ),
    loserNames: v.optional(v.array(v.string())),
    // The club sometimes bails on a dud; no loser, no punishment.
    abandoned: v.optional(v.boolean()),
  },
  returns: v.union(v.id("books"), v.null()),
  handler: async (ctx, args) => {
    const status = args.abandoned
      ? ("abandoned" as const)
      : ("finished" as const);
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- a club's books — bounded (<1000)
    const already = await ctx.db
      .query("books")
      .withIndex("clubStatus", (q) =>
        q.eq("clubId", args.clubId).eq("status", status),
      )
      .collect();
    if (
      already.some(
        (b) => b.title === args.title && b.startedDay === args.startedDay,
      )
    ) {
      return null; // re-run: skip
    }

    const resolve = (name: string) =>
      memberByName(ctx, args.clubId, name, true);
    const rotation = [];
    for (const name of args.rotationNames) {
      rotation.push((await resolve(name))._id);
    }
    let result;
    if (args.resultTallies !== undefined) {
      const tallies = [];
      for (const t of args.resultTallies) {
        tallies.push({ userId: (await resolve(t.name))._id, clouds: t.clouds });
      }
      const loserIds = [];
      for (const name of args.loserNames ?? []) {
        loserIds.push((await resolve(name))._id);
      }
      if (loserIds.length === 0 && tallies.length > 0) {
        const worst = Math.max(...tallies.map((t) => t.clouds));
        loserIds.push(
          ...tallies
            .filter((t) => t.clouds === worst && worst > 0)
            .map((t) => t.userId),
        );
      }
      result = { tallies, loserIds };
    }

    const bookId = await ctx.db.insert("books", {
      clubId: args.clubId,
      title: args.title.trim(),
      author: args.author?.trim() || undefined,
      suggestedBy: args.suggestedByName
        ? (await resolve(args.suggestedByName))._id
        : undefined,
      punishment: args.punishment?.trim() || "(lost to chat history)",
      status,
      rotation,
      startedDay: args.startedDay,
      endedDay: args.endedDay,
      result,
    });
    for (let i = 0; i < args.sections.length; i++) {
      const s = args.sections[i];
      const by = (await resolve(s.byName))._id;
      await ctx.db.insert("sections", {
        bookId,
        index: i,
        title: s.title.trim(),
        assignedTo: by,
        submission: {
          by,
          day: s.day,
          at: Date.parse(`${s.day}T12:00:00Z`),
          quotes: s.quotes ?? "",
          thoughts: s.thoughts ?? "",
          skip: false,
        },
      });
    }
    return bookId;
  },
});

/**
 * Bulk-import historical pushup check-ins (star/storm) parsed from the
 * chat. Insert-if-absent: existing rows for a (user, day) win, so this
 * never clobbers app-recorded data. Call in batches of ≤500.
 */
export const importCheckins = internalMutation({
  args: {
    clubId: v.id("clubs"),
    checkins: v.array(
      v.object({
        userName: v.string(),
        day: v.string(),
        status: checkinStatus,
      }),
    ),
  },
  returns: v.object({ inserted: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => {
    const users = new Map<string, Doc<"users">>();
    let inserted = 0;
    let skipped = 0;
    for (const c of args.checkins) {
      let user = users.get(c.userName);
      if (user === undefined) {
        user = await memberByName(ctx, args.clubId, c.userName, true);
        users.set(c.userName, user);
      }
      const existing = await ctx.db
        .query("checkins")
        .withIndex("userDay", (q) => q.eq("userId", user._id).eq("day", c.day))
        .unique();
      if (existing !== null) {
        skipped += 1;
        continue;
      }
      await ctx.db.insert("checkins", {
        userId: user._id,
        day: c.day,
        status: c.status,
      });
      if (c.status === "storm") {
        await ctx.db.insert("clouds", {
          userId: user._id,
          day: c.day,
          count: 1,
          source: "pushups_storm",
        });
      } else if (c.status === "missed") {
        await ctx.db.insert("clouds", {
          userId: user._id,
          day: c.day,
          count: 2,
          source: "pushups_missed",
        });
      }
      inserted += 1;
    }
    return { inserted, skipped };
  },
});

/**
 * Record a historical pushup check-in with an explicit day. Replaces any
 * existing check-in and its pushup clouds for that day, so re-running with
 * corrected data is safe and it can override what the cron guessed.
 */
export const backfillCheckin = internalMutation({
  args: {
    clubId: v.id("clubs"),
    userName: v.string(),
    day: v.string(), // yyyy-MM-dd in the member's timezone
    status: checkinStatus,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await memberByName(ctx, args.clubId, args.userName);
    const existing = await ctx.db
      .query("checkins")
      .withIndex("userDay", (q) => q.eq("userId", user._id).eq("day", args.day))
      .unique();
    if (existing !== null) {
      await ctx.db.delete("checkins", existing._id);
    }
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- indexed to a bounded day window
    const clouds = await ctx.db
      .query("clouds")
      .withIndex("userDay", (q) => q.eq("userId", user._id).eq("day", args.day))
      .collect();
    for (const entry of clouds) {
      if (
        entry.source === "pushups_storm" ||
        entry.source === "pushups_missed"
      ) {
        await ctx.db.delete("clouds", entry._id);
      }
    }
    await ctx.db.insert("checkins", {
      userId: user._id,
      day: args.day,
      status: args.status,
    });
    if (args.status === "storm") {
      await ctx.db.insert("clouds", {
        userId: user._id,
        day: args.day,
        count: 1,
        source: "pushups_storm",
      });
    } else if (args.status === "missed") {
      await ctx.db.insert("clouds", {
        userId: user._id,
        day: args.day,
        count: 2,
        source: "pushups_missed",
      });
    }
    return null;
  },
});

/**
 * File an off-grid period for a member — the admin twin of `offgrid:declare`,
 * for absences relayed in the group chat instead of the app. Unlike the
 * member-facing version this may be backdated: it replaces any overlapping
 * periods, then converts days that already rolled over as silence (2 clouds)
 * into the storm (1 cloud) the absence buys. Re-running is safe.
 *
 * `toDay` defaults to `fromDay` (a single day away), and `fromDay` to the
 * member's today.
 */
export const setOffGrid = internalMutation({
  args: {
    clubId: v.id("clubs"),
    userName: v.string(),
    fromDay: v.optional(v.string()), // yyyy-MM-dd in the member's timezone
    toDay: v.optional(v.string()), // inclusive; defaults to fromDay
    note: v.optional(v.string()),
  },
  returns: v.object({
    fromDay: v.string(),
    toDay: v.string(),
    replaced: v.number(),
    daysCorrected: v.number(),
  }),
  handler: async (ctx, args) => {
    const user = await memberByName(ctx, args.clubId, args.userName);
    const today = todayInTz(user.timezone);
    const fromDay = args.fromDay ?? today;
    const toDay = args.toDay ?? fromDay;
    for (const day of [fromDay, toDay]) {
      if (!isValidDay(day)) {
        throw new ConvexError(`"${day}" isn't a day (expected yyyy-MM-dd).`);
      }
    }
    if (toDay < fromDay) {
      throw new ConvexError("toDay can't be before fromDay.");
    }
    // The cap keeps `overlappingPeriods` index scans (and the settle loop
    // below) bounded — long absences go in as consecutive periods.
    if (diffDays(toDay, fromDay) + 1 > MAX_OFF_GRID_DAYS) {
      throw new ConvexError(
        `That's longer than ${MAX_OFF_GRID_DAYS} days — file it in stretches.`,
      );
    }
    const existing = await overlappingPeriods(ctx, user._id, fromDay, toDay);
    for (const period of existing) {
      await ctx.db.delete("offGridPeriods", period._id);
    }
    await ctx.db.insert("offGridPeriods", {
      userId: user._id,
      fromDay,
      toDay,
      note: args.note?.trim() || undefined,
      declaredBy: user._id,
    });
    const daysCorrected = await settleOffGridDays(
      ctx,
      user._id,
      fromDay,
      toDay,
      today,
    );
    return { fromDay, toDay, replaced: existing.length, daysCorrected };
  },
});

/**
 * Drop every off-grid period overlapping a range (default: from the member's
 * today onward). Clouds already billed for days away are left alone — undoing
 * those is `backfillCheckin`'s job.
 */
export const clearOffGrid = internalMutation({
  args: {
    clubId: v.id("clubs"),
    userName: v.string(),
    fromDay: v.optional(v.string()),
    toDay: v.optional(v.string()),
  },
  returns: v.object({ removed: v.number() }),
  handler: async (ctx, args) => {
    const user = await memberByName(ctx, args.clubId, args.userName);
    const today = todayInTz(user.timezone);
    const fromDay = args.fromDay ?? today;
    const toDay = args.toDay ?? addDays(fromDay, MAX_OFF_GRID_DAYS);
    const periods = await overlappingPeriods(ctx, user._id, fromDay, toDay);
    for (const period of periods) {
      await ctx.db.delete("offGridPeriods", period._id);
    }
    return { removed: periods.length };
  },
});

// ---------------------------------------------------------------------------
// Quote deck (see convex/quotes.ts)
// ---------------------------------------------------------------------------

/**
 * Build the club's quote deck from every submission already on record.
 * Idempotent per section, so re-running only picks up what's new.
 *
 * Batched because the club has ~1000 sections carrying eight years of text:
 * `limit` caps how many sections one run inspects. Run it until `remaining`
 * comes back 0.
 */
export const indexQuotes = internalMutation({
  args: { clubId: v.id("clubs"), limit: v.optional(v.number()) },
  returns: v.object({
    scanned: v.number(),
    added: v.number(),
    remaining: v.number(),
  }),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 200;
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- a club's books — dozens
    const books = await ctx.db
      .query("books")
      .withIndex("clubStatus", (q) => q.eq("clubId", args.clubId))
      .collect();
    let scanned = 0;
    let added = 0;
    let remaining = 0;
    for (const book of books) {
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- one book's sections — bounded (<1000/book, dozens in practice)
      const sections = await ctx.db
        .query("sections")
        .withIndex("bookIdx", (q) => q.eq("bookId", book._id))
        .collect();
      for (const section of sections) {
        const submission = section.submission;
        if (submission === undefined || submission.quotes.trim() === "") {
          continue;
        }
        // Sections already in the deck are free to skip — they must not eat
        // the batch budget, or a re-run spends its whole limit on finished
        // work and `remaining` never falls.
        const already = await ctx.db
          .query("quotes")
          .withIndex("section", (q) => q.eq("sectionId", section._id))
          .first();
        if (already !== null) {
          continue;
        }
        if (scanned >= limit) {
          remaining++;
          continue;
        }
        scanned++;
        added += await indexSectionQuotes(ctx, {
          clubId: args.clubId,
          bookId: book._id,
          sectionId: section._id,
          submittedBy: submission.by,
          submittedDay: submission.day,
          raw: submission.quotes,
        });
      }
    }
    return { scanned, added, remaining };
  },
});

/**
 * Take a quote out of the deck for good. Hidden quotes keep their row (so the
 * days they were already shown on still resolve) but never come up again.
 */
export const hideQuote = internalMutation({
  args: { quoteId: v.id("quotes"), hidden: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const quote = await ctx.db.get("quotes", args.quoteId);
    if (quote === null) {
      throw new ConvexError("Quote not found.");
    }
    await ctx.db.patch("quotes", args.quoteId, {
      hidden: args.hidden ?? true,
    });
    return null;
  },
});

/**
 * Today's quote is a dud: hide it and deal the next card in its place.
 * `day` defaults to today.
 *
 * Not an undo — it only moves forwards. The replacement is drawn from after
 * the deck's high-water mark (see `mintDailyQuote`), so the card being
 * replaced falls behind the cursor and won't come round again until the deck
 * wraps. Passing `hide: false` therefore rarely does what it looks like: it
 * leaves the dud in the deck for the next pass but still deals a new card.
 */
export const rerollDailyQuote = internalMutation({
  args: {
    clubId: v.id("clubs"),
    day: v.optional(v.string()),
    hide: v.optional(v.boolean()),
  },
  returns: v.object({
    hidQuote: v.boolean(),
    text: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const day = args.day ?? todayInTz(undefined);
    const daily = await ctx.db
      .query("dailyQuotes")
      .withIndex("clubDay", (q) => q.eq("clubId", args.clubId).eq("day", day))
      .unique();
    if (daily === null) {
      throw new ConvexError(`No quote minted for ${day}.`);
    }
    const hide = args.hide ?? true;
    if (hide) {
      await ctx.db.patch("quotes", daily.quoteId, { hidden: true });
    }
    await ctx.db.delete("dailyQuotes", daily._id);
    await mintDailyQuote(ctx, args.clubId, day);
    const fresh = await ctx.db
      .query("dailyQuotes")
      .withIndex("clubDay", (q) => q.eq("clubId", args.clubId).eq("day", day))
      .unique();
    return { hidQuote: hide, text: fresh?.text ?? null };
  },
});
