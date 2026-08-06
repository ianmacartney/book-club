import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { clubRecipientIds, requireMembership } from "./lib/access";
import { todayInTz } from "./lib/days";
import { notifyReply } from "./notifications";

/**
 * Replies to a section write-up — the back-and-forth the club used to have
 * in the group chat. A reply always answers a chapter summary (there is no
 * unattached chat yet), and the feed renders the thread under it.
 */

// Chat, not an essay. Also keeps a reply whole inside a push body.
const MAX_REPLY_CHARS = 2000;

export const post = mutation({
  args: {
    sectionId: v.id("sections"),
    body: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const section = await ctx.db.get("sections", args.sectionId);
    if (section === null) {
      throw new ConvexError("That section is gone.");
    }
    const book = await ctx.db.get("books", section.bookId);
    if (book === null) {
      throw new ConvexError("That book is gone.");
    }
    // Membership in the club is the gate; ghosts talk too — they read along,
    // they just owe nothing. Finished books stay open for discussion.
    const user = await requireMembership(ctx, book.clubId);

    const submission = section.submission;
    if (submission === undefined) {
      throw new ConvexError("Nobody has written that section up yet.");
    }
    const body = args.body.trim();
    if (body.length === 0) {
      throw new ConvexError("Say something first.");
    }
    if (body.length > MAX_REPLY_CHARS) {
      throw new ConvexError("That's an essay — trim it down to a reply.");
    }

    await ctx.db.insert("replies", {
      clubId: book.clubId,
      sectionId: section._id,
      userId: user._id,
      body,
      day: todayInTz(user.timezone),
    });

    await notifyReply(ctx, {
      by: user,
      body,
      bookId: book._id,
      sectionTitle: section.title,
      writerId: submission.by,
      memberIds: await clubRecipientIds(ctx, book.clubId),
    });
    return null;
  },
});
