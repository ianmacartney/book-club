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
  // Historical imports may reference ex-members (ghost users, no membership).
  includeGhosts = false,
): Promise<Doc<"users">> {
  const memberIds = await clubMemberIds(ctx, clubId);
  const pool = includeGhosts
    ? await ctx.db.query("users").collect()
    : (await Promise.all(memberIds.map((id) => ctx.db.get(id)))).filter(
        (m) => m !== null,
      );
  const needle = name.trim().toLowerCase();
  const found = pool.filter(
    (m) =>
      (m.name ?? "").toLowerCase() === needle ||
      m.username.toLowerCase() === needle,
  );
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
 * A user row for a former member so historical books can reference them.
 * No membership row, so they never accrue new obligations and can't log in.
 */
export const createGhostUser = internalMutation({
  args: {
    username: v.string(),
    name: v.string(),
    timezone: v.optional(v.string()),
  },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("username", (q) => q.eq("username", args.username))
      .unique();
    if (existing !== null) {
      return existing._id;
    }
    return await ctx.db.insert("users", {
      username: args.username,
      name: args.name,
      timezone: args.timezone,
    });
  },
});

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
      await ctx.db.patch(existing._id, { role });
    }
    return null;
  },
});

/**
 * Delete a `users` row that nothing references — cleanup for a duplicate
 * identity created by an accidental second sign-up (see the "Peter" case,
 * 2026-07-29).
 *
 * Refuses unless the row is unreferenced everywhere, so it can't take a real
 * member with it, nor a ghost like Tucker whose row is still cited by years of
 * books and sections. Deleting the app row does NOT remove the auth account
 * that points at it (component data is only reachable through the component's
 * own API, and it exposes no delete) — remove that in the Convex dashboard,
 * under the `core` component's `accounts` table, or the username stays claimed.
 * Order doesn't matter: `users.createOrUpdateUser` re-binds rather than failing
 * if an account outlives its row.
 */
export const deleteOrphanUser = internalMutation({
  args: { userId: v.id("users") },
  returns: v.string(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (user === null) {
      throw new ConvexError(`No such user: ${args.userId}`);
    }
    const id = args.userId;
    const blockers: string[] = [];
    const note = (n: number, what: string) => {
      if (n > 0) blockers.push(`${n} ${what}`);
    };

    note(
      (
        await ctx.db
          .query("memberships")
          .withIndex("userId", (q) => q.eq("userId", id))
          .collect()
      ).length,
      "membership(s)",
    );
    note(
      (
        await ctx.db
          .query("checkins")
          .withIndex("userDay", (q) => q.eq("userId", id))
          .collect()
      ).length,
      "checkin(s)",
    );
    note(
      (
        await ctx.db
          .query("clouds")
          .withIndex("userDay", (q) => q.eq("userId", id))
          .collect()
      ).length,
      "cloud row(s)",
    );
    note(
      (
        await ctx.db
          .query("notificationPrefs")
          .withIndex("userId", (q) => q.eq("userId", id))
          .collect()
      ).length,
      "notification pref(s)",
    );

    const books = await ctx.db.query("books").collect();
    note(
      books.filter(
        (b) =>
          b.suggestedBy === id ||
          b.rotation.includes(id) ||
          (b.result?.loserIds ?? []).includes(id) ||
          (b.result?.tallies ?? []).some((t) => t.userId === id),
      ).length,
      "book(s)",
    );
    const sections = await ctx.db.query("sections").collect();
    note(
      sections.filter(
        (s) => s.assignedTo === id || s.submission?.by === id,
      ).length,
      "section(s)",
    );
    note(
      (await ctx.db.query("clubs").collect()).filter((c) => c.createdBy === id)
        .length,
      "club(s) created",
    );
    note(
      (await ctx.db.query("polls").collect()).filter((p) => p.createdBy === id)
        .length,
      "poll(s)",
    );
    note(
      (await ctx.db.query("nominations").collect()).filter(
        (n) => n.suggestedBy === id,
      ).length,
      "nomination(s)",
    );
    note(
      (await ctx.db.query("votes").collect()).filter((v2) => v2.userId === id)
        .length,
      "vote(s)",
    );
    note(
      (await ctx.db.query("summaries").collect()).filter((s) =>
        s.entries.some((e) => e.userId === id),
      ).length,
      "summary/summaries",
    );
    note(
      (await ctx.db.query("invites").collect()).filter(
        (i) => i.createdBy === id || i.usedBy === id,
      ).length,
      "invite(s)",
    );

    if (blockers.length > 0) {
      throw new ConvexError(
        `Refusing to delete ${user.name ?? "?"} (@${user.username}): still referenced by ` +
          `${blockers.join(", ")}. This is not an orphan.`,
      );
    }
    await ctx.db.delete(id);
    return `Deleted orphan user ${user.name ?? "?"} (@${user.username})`;
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
    const status = args.abandoned ? ("abandoned" as const) : ("finished" as const);
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
