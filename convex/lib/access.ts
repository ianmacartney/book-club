import { ConvexError } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";
import { MutationCtx, QueryCtx } from "../_generated/server";

export async function currentUserId(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    return null;
  }
  return ctx.db.normalizeId("users", identity.subject);
}

export async function requireUser(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  const userId = await currentUserId(ctx);
  const user = userId === null ? null : await ctx.db.get(userId);
  if (user === null) {
    throw new ConvexError("Not signed in.");
  }
  return user;
}

export async function requireMembership(
  ctx: QueryCtx | MutationCtx,
  clubId: Id<"clubs">,
): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  const membership = await ctx.db
    .query("memberships")
    .withIndex("clubUser", (q) => q.eq("clubId", clubId).eq("userId", user._id))
    .unique();
  if (membership === null) {
    throw new ConvexError("You are not a member of this club.");
  }
  return user;
}

export async function clubMemberIds(
  ctx: QueryCtx | MutationCtx,
  clubId: Id<"clubs">,
): Promise<Id<"users">[]> {
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("clubId", (q) => q.eq("clubId", clubId))
    .collect();
  // Join order doubles as the default reading-rotation order.
  return memberships.map((m) => m.userId);
}
