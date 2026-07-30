import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  clubMemberships,
  currentUserId,
  isGhost,
  requireMembership,
  requireUser,
} from "./lib/access";
import { cloudsForUser } from "./lib/clouds";
import { isPushupDay, todayInTz } from "./lib/days";

function generateInviteCode(): string {
  // Crypto-strength: the code is a bearer credential for joining the club.
  // No ambiguous characters (0/O, 1/I/L).
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

export const create = mutation({
  args: { name: v.string() },
  returns: v.id("clubs"),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const name = args.name.trim();
    if (name.length === 0) {
      throw new ConvexError("Club name can't be empty.");
    }
    const clubId = await ctx.db.insert("clubs", {
      name,
      createdBy: user._id,
    });
    await ctx.db.insert("memberships", { clubId, userId: user._id });
    return clubId;
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await currentUserId(ctx);
    if (userId === null) {
      return [];
    }
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- a user's club memberships — a small bounded set
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
    const clubs = await Promise.all(
      memberships.map(async (m) => {
        const club = await ctx.db.get("clubs", m.clubId);
        return club === null ? null : { _id: club._id, name: club.name };
      }),
    );
    return clubs.filter((c) => c !== null);
  },
});

export const createInvite = mutation({
  args: { clubId: v.id("clubs"), forName: v.optional(v.string()) },
  returns: v.string(),
  handler: async (ctx, args) => {
    const user = await requireMembership(ctx, args.clubId);
    const forName = args.forName?.trim() || undefined;
    // A collision would brick both codes (joinWithCode uses .unique()), so
    // regenerate on the off chance.
    let code = generateInviteCode();
    while (
      (await ctx.db
        .query("invites")
        .withIndex("code", (q) => q.eq("code", code))
        .unique()) !== null
    ) {
      code = generateInviteCode();
    }
    await ctx.db.insert("invites", {
      clubId: args.clubId,
      code,
      createdBy: user._id,
      forName,
    });
    return code;
  },
});

export const joinWithCode = mutation({
  args: { code: v.string() },
  returns: v.id("clubs"),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const invite = await ctx.db
      .query("invites")
      .withIndex("code", (q) => q.eq("code", args.code.trim().toUpperCase()))
      .unique();
    if (invite === null) {
      throw new ConvexError("That invite code doesn't exist.");
    }
    if (invite.usedBy !== undefined) {
      throw new ConvexError("That invite code has already been used.");
    }
    const existing = await ctx.db
      .query("memberships")
      .withIndex("clubUser", (q) =>
        q.eq("clubId", invite.clubId).eq("userId", user._id),
      )
      .unique();
    if (existing !== null) {
      throw new ConvexError("You're already a member of this club.");
    }
    await ctx.db.patch("invites", invite._id, { usedBy: user._id });
    // A labeled invite names its intended recipient; adopt it as the display
    // name unless they've already picked one.
    if (invite.forName !== undefined && user.name === undefined) {
      await ctx.db.patch("users", user._id, { name: invite.forName });
    }
    await ctx.db.insert("memberships", {
      clubId: invite.clubId,
      userId: user._id,
    });
    return invite.clubId;
  },
});

export const openInvites = query({
  args: { clubId: v.id("clubs") },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.clubId);
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- a club's invites — bounded
    const invites = await ctx.db
      .query("invites")
      .withIndex("clubId", (q) => q.eq("clubId", args.clubId))
      .collect();
    return invites
      .filter((i) => i.usedBy === undefined)
      .map((i) => ({ _id: i._id, code: i.code, forName: i.forName ?? null }));
  },
});

/**
 * Everything the club dashboard needs: members with today's check-in
 * status and running cloud tallies, scoped to the active book if there
 * is one.
 */
export const home = query({
  args: { clubId: v.id("clubs") },
  handler: async (ctx, args) => {
    const viewer = await requireMembership(ctx, args.clubId);
    const club = await ctx.db.get("clubs", args.clubId);
    if (club === null) {
      throw new ConvexError("Club not found.");
    }
    const memberships = await clubMemberships(ctx, args.clubId);
    const memberIds = memberships
      .filter((m) => !isGhost(m))
      .map((m) => m.userId);
    const activeBook = await ctx.db
      .query("books")
      .withIndex("clubStatus", (q) =>
        q.eq("clubId", args.clubId).eq("status", "active"),
      )
      .first();

    const members = await Promise.all(
      memberIds.map(async (userId) => {
        const user = await ctx.db.get("users", userId);
        if (user === null) {
          return null;
        }
        const today = todayInTz(user.timezone);
        const checkin = await ctx.db
          .query("checkins")
          .withIndex("userDay", (q) => q.eq("userId", userId).eq("day", today))
          .unique();
        const bookClouds = activeBook
          ? await cloudsForUser(ctx, userId, args.clubId, activeBook.startedDay)
          : 0;
        return {
          _id: userId,
          name: user.name ?? user.username,
          timezone: user.timezone ?? null,
          today,
          isPushupDay: isPushupDay(today),
          checkinToday: checkin?.status ?? null,
          bookClouds,
        };
      }),
    );

    // Ghosts watch from the doorway: listed, but with no statuses or clouds.
    const ghosts = await Promise.all(
      memberships
        .filter(isGhost)
        .map(async (m) => {
          const user = await ctx.db.get("users", m.userId);
          return user === null
            ? null
            : { _id: user._id, name: user.name ?? user.username };
        }),
    );

    return {
      club: { _id: club._id, name: club.name },
      viewerId: viewer._id,
      viewerIsGhost:
        memberships.find((m) => m.userId === viewer._id)?.role === "ghost",
      members: members.filter((m) => m !== null),
      ghosts: ghosts.filter((g) => g !== null),
      activeBookId: activeBook?._id ?? null,
    };
  },
});
