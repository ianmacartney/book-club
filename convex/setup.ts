import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { startBookHelper } from "./books";
import { clubMemberIds } from "./lib/access";

/**
 * Admin one-shot (`npx convex run setup:startBookAsAdmin`): start a book
 * with an explicit rotation and suggester, matched by display name or
 * username. For kicking off a book whose reading order was agreed outside
 * the app — the in-app form only does join-order rotation and credits the
 * caller as suggester.
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
  },
  returns: v.id("books"),
  handler: async (ctx, args) => {
    const memberIds = await clubMemberIds(ctx, args.clubId);
    const members = (
      await Promise.all(memberIds.map((id) => ctx.db.get(id)))
    ).filter((m) => m !== null);
    const byName = (name: string) => {
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
      return found[0]._id;
    };
    return await startBookHelper(ctx, {
      clubId: args.clubId,
      title: args.title,
      author: args.author,
      punishment: args.punishment,
      suggestedBy: byName(args.suggestedByName),
      rotation: args.rotationNames.map(byName),
      sectionTitles: args.sectionTitles,
    });
  },
});
