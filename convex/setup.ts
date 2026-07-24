import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, internalMutation } from "./_generated/server";
import { DAYS_PER_SECTION, finishBook, startBookHelper } from "./books";
import { clubMemberIds } from "./lib/access";
import { accrueLateClouds } from "./lib/clouds";
import { addDays } from "./lib/days";
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
): Promise<Doc<"users">> {
  const memberIds = await clubMemberIds(ctx, clubId);
  const members = (
    await Promise.all(memberIds.map((id) => ctx.db.get(id)))
  ).filter((m) => m !== null);
  const needle = name.trim().toLowerCase();
  const found = members.filter(
    (m) =>
      (m.name ?? "").toLowerCase() === needle ||
      m.username.toLowerCase() === needle,
  );
  if (found.length !== 1) {
    throw new ConvexError(
      `${found.length === 0 ? "No" : "Multiple"} members match "${name}". ` +
        `Members: ` +
        members.map((m) => `${m.name ?? "?"} (@${m.username})`).join(", "),
    );
  }
  return found[0];
}

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
    const book = await ctx.db.get(args.bookId);
    if (book === null || book.status !== "active") {
      throw new ConvexError("Book not found or not active.");
    }
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
    const billed = await ctx.db
      .query("clouds")
      .withIndex("sectionDay", (q) =>
        q.eq("sectionId", current._id).gt("day", args.day),
      )
      .collect();
    for (const entry of billed) {
      await ctx.db.delete(entry._id);
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
    await ctx.db.patch(current._id, {
      submission: {
        by: by._id,
        day: args.day,
        at: Date.parse(`${args.day}T12:00:00Z`),
        quotes: args.quotes ?? "",
        thoughts: args.thoughts ?? "(backfilled from the group chat)",
        skip: isSkip,
      },
    });

    const next = sections.find((s) => s.index === current.index + 1);
    if (next !== undefined) {
      await ctx.db.patch(next._id, {
        dueDay: addDays(args.day, DAYS_PER_SECTION),
      });
    } else {
      await finishBook(ctx, book);
    }
    return null;
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
      await ctx.db.delete(existing._id);
    }
    const clouds = await ctx.db
      .query("clouds")
      .withIndex("userDay", (q) => q.eq("userId", user._id).eq("day", args.day))
      .collect();
    for (const entry of clouds) {
      if (entry.source === "pushups_storm" || entry.source === "pushups_missed") {
        await ctx.db.delete(entry._id);
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
