import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, mutation, query } from "./_generated/server";
import { startBookHelper } from "./books";
import { clubMemberIds, requireMembership } from "./lib/access";

const NOMINATIONS_PER_MEMBER = 2;
const VOTES_PER_MEMBER = 2;

export const start = mutation({
  args: { clubId: v.id("clubs") },
  returns: v.id("polls"),
  handler: async (ctx, args) => {
    const user = await requireMembership(ctx, args.clubId);
    const open = await openPoll(ctx, args.clubId);
    if (open !== null) {
      throw new ConvexError("There's already a poll in progress.");
    }
    return await ctx.db.insert("polls", {
      clubId: args.clubId,
      createdBy: user._id,
      status: "nominating",
    });
  },
});

async function openPoll(ctx: MutationCtx, clubId: Id<"clubs">) {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- a club's polls — one active at a time, history grows slowly
  const polls = await ctx.db
    .query("polls")
    .withIndex("clubId", (q) => q.eq("clubId", clubId))
    .collect();
  return polls.find((p) => p.status !== "done") ?? null;
}

async function getPollForMember(ctx: MutationCtx, pollId: Id<"polls">) {
  const poll = await ctx.db.get("polls", pollId);
  if (poll === null) {
    throw new ConvexError("Poll not found.");
  }
  const user = await requireMembership(ctx, poll.clubId);
  return { poll, user };
}

/** Everyone puts up two options, stakes included. */
export const nominate = mutation({
  args: {
    pollId: v.id("polls"),
    title: v.string(),
    author: v.optional(v.string()),
    punishment: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { poll, user } = await getPollForMember(ctx, args.pollId);
    if (poll.status !== "nominating") {
      throw new ConvexError("Nominations are closed.");
    }
    if (args.title.trim().length === 0) {
      throw new ConvexError("The book needs a title.");
    }
    if (args.punishment.trim().length === 0) {
      throw new ConvexError(
        "Every suggestion must come with a punishment for the loser.",
      );
    }
    const mine = (await pollNominations(ctx, poll._id)).filter(
      (n) => n.suggestedBy === user._id,
    );
    if (mine.length >= NOMINATIONS_PER_MEMBER) {
      throw new ConvexError(
        `You already have ${NOMINATIONS_PER_MEMBER} nominations — withdraw one first.`,
      );
    }
    await ctx.db.insert("nominations", {
      pollId: poll._id,
      title: args.title.trim(),
      author: args.author?.trim() || undefined,
      punishment: args.punishment.trim(),
      suggestedBy: user._id,
    });
    return null;
  },
});

export const withdrawNomination = mutation({
  args: { nominationId: v.id("nominations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const nomination = await ctx.db.get("nominations", args.nominationId);
    if (nomination === null) {
      throw new ConvexError("Nomination not found.");
    }
    const { poll, user } = await getPollForMember(ctx, nomination.pollId);
    if (poll.status !== "nominating") {
      throw new ConvexError("Nominations are closed.");
    }
    if (nomination.suggestedBy !== user._id) {
      throw new ConvexError("You can only withdraw your own nomination.");
    }
    await ctx.db.delete("nominations", nomination._id);
    return null;
  },
});

async function pollNominations(ctx: MutationCtx, pollId: Id<"polls">) {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- one poll's nominations — at most one per member (~100)
  return await ctx.db
    .query("nominations")
    .withIndex("pollId", (q) => q.eq("pollId", pollId))
    .collect();
}

export const closeNominations = mutation({
  args: { pollId: v.id("polls") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { poll } = await getPollForMember(ctx, args.pollId);
    if (poll.status !== "nominating") {
      throw new ConvexError("Nominations are already closed.");
    }
    const nominations = await pollNominations(ctx, poll._id);
    if (nominations.length < 2) {
      throw new ConvexError("Need at least two nominations to vote.");
    }
    await ctx.db.patch("polls", poll._id, { status: "voting" });
    return null;
  },
});

/**
 * First round: up to two picks, at most one of which is your own.
 * Runoff round: exactly one pick from the runoff slate.
 * Recasting replaces your ballot. When the last member votes, the round
 * tallies itself.
 */
export const castVote = mutation({
  args: {
    pollId: v.id("polls"),
    nominationIds: v.array(v.id("nominations")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { poll, user } = await getPollForMember(ctx, args.pollId);
    if (poll.status !== "voting" && poll.status !== "runoff") {
      throw new ConvexError("Voting isn't open.");
    }
    const round = poll.status === "voting" ? "initial" : "runoff";
    const unique = [...new Set(args.nominationIds)];
    if (unique.length !== args.nominationIds.length) {
      throw new ConvexError("You can't vote for the same book twice.");
    }
    const nominations = await pollNominations(ctx, poll._id);
    const valid =
      round === "runoff"
        ? (poll.runoffNominationIds ?? [])
        : nominations.map((n) => n._id);
    for (const id of unique) {
      if (!valid.includes(id)) {
        throw new ConvexError("That book isn't on the ballot.");
      }
    }
    if (round === "initial") {
      if (unique.length < 1 || unique.length > VOTES_PER_MEMBER) {
        throw new ConvexError(`Vote for 1 or ${VOTES_PER_MEMBER} books.`);
      }
      const ownVotes = unique.filter(
        (id) =>
          nominations.find((n) => n._id === id)?.suggestedBy === user._id,
      );
      if (ownVotes.length > 1) {
        throw new ConvexError("You can only vote for one of your own suggestions.");
      }
    } else if (unique.length !== 1) {
      throw new ConvexError("The runoff is a single vote.");
    }

    const existing = await ctx.db
      .query("votes")
      .withIndex("pollRoundUser", (q) =>
        q.eq("pollId", poll._id).eq("round", round).eq("userId", user._id),
      )
      .unique();
    if (existing !== null) {
      await ctx.db.patch("votes", existing._id, { nominationIds: unique });
    } else {
      await ctx.db.insert("votes", {
        pollId: poll._id,
        round,
        userId: user._id,
        nominationIds: unique,
      });
    }

    // Auto-tally once every member has voted.
    const memberIds = await clubMemberIds(ctx, poll.clubId);
    const votes = await roundVotes(ctx, poll._id, round);
    if (memberIds.every((m) => votes.some((vt) => vt.userId === m))) {
      await tallyRound(ctx, poll, round);
    }
    return null;
  },
});

/** Force the tally without waiting for stragglers. */
export const closeRound = mutation({
  args: { pollId: v.id("polls") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { poll } = await getPollForMember(ctx, args.pollId);
    if (poll.status !== "voting" && poll.status !== "runoff") {
      throw new ConvexError("Voting isn't open.");
    }
    const round = poll.status === "voting" ? "initial" : "runoff";
    const votes = await roundVotes(ctx, poll._id, round);
    if (votes.length === 0) {
      throw new ConvexError("Nobody has voted yet.");
    }
    await tallyRound(ctx, poll, round);
    return null;
  },
});

async function roundVotes(
  ctx: MutationCtx,
  pollId: Id<"polls">,
  round: "initial" | "runoff",
) {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- one round's votes — at most one per member (~100)
  return await ctx.db
    .query("votes")
    .withIndex("pollRound", (q) => q.eq("pollId", pollId).eq("round", round))
    .collect();
}

function scores(
  candidates: Id<"nominations">[],
  votes: Doc<"votes">[],
): Map<Id<"nominations">, number> {
  const result = new Map(candidates.map((id) => [id, 0]));
  for (const vote of votes) {
    for (const id of vote.nominationIds) {
      if (result.has(id)) {
        result.set(id, result.get(id)! + 1);
      }
    }
  }
  return result;
}

async function tallyRound(
  ctx: MutationCtx,
  poll: Doc<"polls">,
  round: "initial" | "runoff",
) {
  const votes = await roundVotes(ctx, poll._id, round);

  if (round === "initial") {
    const nominations = await pollNominations(ctx, poll._id);
    const tally = scores(
      nominations.map((n) => n._id),
      votes,
    );
    const distinct = [...new Set(tally.values())].sort((a, b) => b - a);
    const top = distinct[0];
    const first = [...tally.entries()]
      .filter(([, s]) => s === top)
      .map(([id]) => id);
    // Top two go to a runoff; a 3+-way tie for first sends them all.
    let slate = first;
    if (first.length === 1 && distinct.length > 1) {
      const second = [...tally.entries()]
        .filter(([, s]) => s === distinct[1])
        .map(([id]) => id);
      slate = [...first, ...second];
    }
    if (slate.length === 1) {
      await ctx.db.patch("polls", poll._id, {
        status: "done",
        winnerNominationId: slate[0],
      });
    } else {
      await ctx.db.patch("polls", poll._id, {
        status: "runoff",
        runoffNominationIds: slate,
      });
    }
    return;
  }

  // Runoff: single winner, or a fresh runoff among any tied leaders.
  const slate = poll.runoffNominationIds ?? [];
  const tally = scores(slate, votes);
  const top = Math.max(...tally.values());
  const leaders = [...tally.entries()]
    .filter(([, s]) => s === top)
    .map(([id]) => id);
  if (leaders.length === 1) {
    await ctx.db.patch("polls", poll._id, {
      status: "done",
      winnerNominationId: leaders[0],
    });
  } else {
    for (const vote of votes) {
      await ctx.db.delete("votes", vote._id);
    }
    await ctx.db.patch("polls", poll._id, { runoffNominationIds: leaders });
  }
}

/** Kick off the winning book once the poll is done. */
export const startWinningBook = mutation({
  args: {
    pollId: v.id("polls"),
    sectionTitles: v.array(v.string()),
    rotation: v.optional(v.array(v.id("users"))),
  },
  returns: v.id("books"),
  handler: async (ctx, args) => {
    const { poll } = await getPollForMember(ctx, args.pollId);
    if (poll.status !== "done" || poll.winnerNominationId === undefined) {
      throw new ConvexError("This poll hasn't picked a winner yet.");
    }
    const winner = await ctx.db.get("nominations", poll.winnerNominationId);
    if (winner === null) {
      throw new ConvexError("Winning nomination is missing.");
    }
    return await startBookHelper(ctx, {
      clubId: poll.clubId,
      title: winner.title,
      author: winner.author,
      punishment: winner.punishment,
      suggestedBy: winner.suggestedBy,
      sectionTitles: args.sectionTitles,
      rotation: args.rotation,
      pollId: poll._id,
    });
  },
});

/** Everything the voting tab needs for the club's latest poll. */
export const state = query({
  args: { clubId: v.id("clubs") },
  handler: async (ctx, args) => {
    const viewer = await requireMembership(ctx, args.clubId);
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- a club's polls — one active at a time, history grows slowly
    const polls = await ctx.db
      .query("polls")
      .withIndex("clubId", (q) => q.eq("clubId", args.clubId))
      .order("desc")
      .collect();
    const poll = polls.find((p) => p.status !== "done") ?? polls[0] ?? null;
    if (poll === null) {
      return null;
    }
    const memberIds = await clubMemberIds(ctx, args.clubId);
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- one poll's nominations — at most one per member (~100)
    const nominations = await ctx.db
      .query("nominations")
      .withIndex("pollId", (q) => q.eq("pollId", poll._id))
      .collect();
    const names = new Map<Id<"users">, string>();
    for (const id of memberIds) {
      const u = await ctx.db.get("users", id);
      names.set(id, u?.name ?? u?.username ?? "?");
    }
    const round = poll.status === "runoff" ? "runoff" : "initial";
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- one round's votes — at most one per member (~100)
    const votes = await ctx.db
      .query("votes")
      .withIndex("pollRound", (q) =>
        q.eq("pollId", poll._id).eq("round", round),
      )
      .collect();
    const myVote = votes.find((vt) => vt.userId === viewer._id) ?? null;
    const activeBook = await ctx.db
      .query("books")
      .withIndex("clubStatus", (q) =>
        q.eq("clubId", args.clubId).eq("status", "active"),
      )
      .first();

    return {
      clubIsReading: activeBook !== null,
      _id: poll._id,
      status: poll.status,
      viewerId: viewer._id,
      nominations: nominations.map((n) => ({
        _id: n._id,
        title: n.title,
        author: n.author ?? null,
        punishment: n.punishment,
        suggestedBy: n.suggestedBy,
        suggestedByName: names.get(n.suggestedBy) ?? "?",
        mine: n.suggestedBy === viewer._id,
        inRunoff: poll.runoffNominationIds?.includes(n._id) ?? false,
        isWinner: poll.winnerNominationId === n._id,
      })),
      myNominationCount: nominations.filter(
        (n) => n.suggestedBy === viewer._id,
      ).length,
      myVote: myVote?.nominationIds ?? null,
      votesCast: votes.length,
      memberCount: memberIds.length,
      winnerNominationId: poll.winnerNominationId ?? null,
    };
  },
});
