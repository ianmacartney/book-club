import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireMembership } from "./lib/access";

/**
 * Free-form feedback from members about the app. Stored in the `feedback`
 * table; read from the dashboard (no in-app admin view yet).
 */

// Generous — a paragraph or three — but bounded so a runaway paste can't land.
const MAX_FEEDBACK_CHARS = 4000;

export const submit = mutation({
  args: {
    message: v.string(),
    // Required: feedback comes from a member of a specific club. Membership in
    // that club is the authorization gate (ghosts count — they watch the club
    // and may have plenty to say).
    clubId: v.id("clubs"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireMembership(ctx, args.clubId);
    const message = args.message.trim();
    if (message.length === 0) {
      throw new ConvexError("Feedback can't be empty.");
    }
    if (message.length > MAX_FEEDBACK_CHARS) {
      throw new ConvexError("That's a lot of feedback — please shorten it.");
    }
    await ctx.db.insert("feedback", {
      userId: user._id,
      message,
      clubId: args.clubId,
    });
    return null;
  },
});
