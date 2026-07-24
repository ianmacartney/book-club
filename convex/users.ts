import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { currentUserId, requireUser } from "./lib/access";
import { isValidTimezone, todayInTz } from "./lib/days";

/** Called by Convex Auth whenever an account signs up or in. */
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
      if (existing === null) {
        throw new ConvexError(`Unknown user id: ${args.userId}`);
      }
      return existing;
    }
    const username =
      typeof args.profile?.username === "string"
        ? args.profile.username
        : "anonymous";
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
    const user = await ctx.db.get(userId);
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
    await ctx.db.patch(user._id, {
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
      await ctx.db.patch(user._id, { timezone: args.timezone });
    }
    return null;
  },
});
