import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { currentUserId, requireUser } from "./lib/access";
import { isValidTimezone, todayInTz } from "./lib/days";

/**
 * Called by Convex Auth whenever an account signs up or in.
 *
 * A new account **claims a matching account-less `users` row** rather than
 * creating a second identity. That's how an ex-member (a ghost like Tucker,
 * whose row is referenced by years of books and sections) can sign in and land
 * on his own history instead of a fresh empty row. Without it, signing up
 * always forked a new identity — which is how a duplicate "Peter" appeared.
 *
 * This can't be used to hijack an active member: `signUpWithPassword` rejects a
 * username that already has an account (`USERNAME_TAKEN`) before ever calling
 * this, so the only rows reachable here are ones nobody can sign in as.
 *
 * TODO(remove-username-claim): the claim-by-username lookup below exists only so
 * the pre-app roster (imported from iMessage) can be adopted by the accounts of
 * people who were members before the app existed. Tucker is the last such
 * ex-member; once he's signed in and claimed his row, no future member needs
 * this — they'll sign up into a fresh row. Rip out the lookup then and let the
 * handler just re-bind by `args.userId` or insert. That also retires the pile of
 * hard-coded admin scripts/workflows in `setup.ts` that only exist to reconcile
 * the imported roster with real accounts.
 */
export const createOrUpdateUser = internalMutation({
  args: {
    provider: v.literal("password"),
    providerAccountId: v.string(),
    profile: v.any(),
    userId: v.union(v.string(), v.null()),
  },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    if (args.userId !== null) {
      const existing = ctx.db.normalizeId("users", args.userId);
      // If the row is gone (e.g. an orphan we cleaned up), don't hard-fail the
      // sign-in — fall through and re-bind, so a stale account can't lock
      // someone out of the app entirely.
      if (existing !== null && (await ctx.db.get("users", existing)) !== null) {
        return existing;
      }
    }
    const username =
      typeof args.profile?.username === "string"
        ? args.profile.username
        : "anonymous";

    // Accounts are keyed by lowercased username while `users.username` keeps
    // its original casing ("Ian M", "Schoony"), so match case-insensitively.
    // Only an unambiguous single match is claimed; anything else gets a new row.
    const needle = username.trim().toLowerCase();
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- all members + ghosts — a few dozen; matched case-insensitively
    const matches = (await ctx.db.query("users").collect()).filter(
      (u) => u.username.trim().toLowerCase() === needle,
    );
    if (matches.length === 1) {
      return matches[0]._id;
    }
    return await ctx.db.insert("users", { username });
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await currentUserId(ctx);
    if (userId === null) {
      return null;
    }
    const user = await ctx.db.get("users", userId);
    if (user === null) {
      return null;
    }
    return {
      _id: user._id,
      username: user.username,
      name: user.name ?? user.username,
      timezone: user.timezone ?? null,
      today: todayInTz(user.timezone),
    };
  },
});

export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    timezone: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (args.timezone !== undefined && !isValidTimezone(args.timezone)) {
      throw new ConvexError(`Unknown timezone: ${args.timezone}`);
    }
    const name = args.name?.trim();
    if (name !== undefined && name.length === 0) {
      throw new ConvexError("Name can't be empty.");
    }
    await ctx.db.patch("users", user._id, {
      ...(name !== undefined ? { name } : {}),
      ...(args.timezone !== undefined ? { timezone: args.timezone } : {}),
    });
    return null;
  },
});

/**
 * Called once after sign-in: fills in the timezone from the browser if the
 * member hasn't picked one yet. Timezone drives every deadline, so we want
 * a real value instead of the server default as early as possible.
 */
export const ensureTimezone = mutation({
  args: { timezone: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (user.timezone === undefined && isValidTimezone(args.timezone)) {
      await ctx.db.patch("users", user._id, { timezone: args.timezone });
    }
    return null;
  },
});
