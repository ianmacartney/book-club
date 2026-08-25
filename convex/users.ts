import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { currentUserId, requireUser } from "./lib/access";
import { isValidTimezone, readerDay, viewerDay } from "./lib/days";

/**
 * Create the user row for a new password account and return its id. This
 * example keeps no data in the row, but your app can put a profile here.
 */
export const createUser = internalMutation({
  args: {
    provider: v.literal("password"),
    providerAccountId: v.string(),
    profile: v.object({ username: v.string() }),
  },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("users", {
      name: args.profile.username,
    });
  },
});

export const me = query({
  // Returns `today`, so it needs the reader's day to stay current.
  args: { viewerDay },
  handler: async (ctx, args) => {
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
      name: user.name,
      timezone: user.timezone ?? null,
      today: readerDay(args.viewerDay, user.timezone),
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
