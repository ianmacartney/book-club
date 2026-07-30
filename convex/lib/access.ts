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
  const user = userId === null ? null : await ctx.db.get("users", userId);
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

export async function clubMemberships(
  ctx: QueryCtx | MutationCtx,
  clubId: Id<"clubs">,
): Promise<Doc<"memberships">[]> {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- a club's members — bounded (~100)
  return await ctx.db
    .query("memberships")
    .withIndex("clubId", (q) => q.eq("clubId", clubId))
    .collect();
}

export function isGhost(membership: Doc<"memberships">): boolean {
  return membership.role === "ghost";
}

/**
 * Full members only — the people with pushups at stake and a place in the
 * reading rotation. Join order doubles as the default rotation order.
 */
export async function clubMemberIds(
  ctx: QueryCtx | MutationCtx,
  clubId: Id<"clubs">,
): Promise<Id<"users">[]> {
  const memberships = await clubMemberships(ctx, clubId);
  return memberships.filter((m) => !isGhost(m)).map((m) => m.userId);
}

/** Everyone with eyes on the club — members and ghosts. For notifications
 * and feed visibility, not for obligations. */
export async function clubRecipientIds(
  ctx: QueryCtx | MutationCtx,
  clubId: Id<"clubs">,
): Promise<Id<"users">[]> {
  const memberships = await clubMemberships(ctx, clubId);
  return memberships.map((m) => m.userId);
}

/** Does this user owe pushups anywhere — i.e. hold any non-ghost membership? */
export async function hasActiveMembership(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<boolean> {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- a user's club memberships — a small bounded set
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .collect();
  return memberships.some((m) => !isGhost(m));
}
