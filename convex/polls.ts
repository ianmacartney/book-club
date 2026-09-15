import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, QueryCtx, mutation, query } from "./_generated/server";
import { startBookHelper } from "./books";
import {
  clubMemberIds,
  requireMembership,
  requireMembershipRow,
} from "./lib/access";
import { countVotes, orderCounts, rankedChoice, Result } from "./lib/voting";
import { bookSetup, pollResult, pollStatus, votingMethod } from "./schema";

type ReadCtx = QueryCtx | MutationCtx;

async function latestPoll(ctx: ReadCtx, clubId: Id<"clubs">) {
  return await ctx.db
    .query("polls")
    .withIndex("clubId", (q) => q.eq("clubId", clubId))
    .order("desc")
    .first();
}

async function openPoll(ctx: ReadCtx, clubId: Id<"clubs">) {
  for (const status of ["nominating", "voting", "runoff"] as const) {
    const poll = await ctx.db
      .query("polls")
      .withIndex("clubStatus", (q) =>
        q.eq("clubId", clubId).eq("status", status),
      )
      .first();
    if (poll) return poll;
  }
  return null;
}

async function bookForPoll(ctx: ReadCtx, pollId: Id<"polls">) {
  return await ctx.db
    .query("books")
    .withIndex("pollId", (q) => q.eq("pollId", pollId))
    .first();
}

async function requireParticipant(ctx: ReadCtx, clubId: Id<"clubs">) {
  const { user, membership } = await requireMembershipRow(ctx, clubId);
  if (membership.role === "ghost")
    throw new ConvexError(
      "Only active club members can participate in book selection.",
    );
  return user;
}

async function getPollForMember(ctx: ReadCtx, pollId: Id<"polls">) {
  const poll = await ctx.db.get("polls", pollId);
  if (!poll) throw new ConvexError("Poll not found.");
  const user = await requireParticipant(ctx, poll.clubId);
  return { poll, user };
}

async function requireOrganizer(
  ctx: ReadCtx,
  poll: Doc<"polls">,
  userId: Id<"users">,
) {
  const club = await ctx.db.get("clubs", poll.clubId);
  if (poll.createdBy !== userId && club?.createdBy !== userId) {
    throw new ConvexError(
      "Only the poll organizer or club creator can close a round.",
    );
  }
}

async function pollNominations(ctx: ReadCtx, pollId: Id<"polls">) {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- at most two per member in this club's poll
  return await ctx.db
    .query("nominations")
    .withIndex("pollId", (q) => q.eq("pollId", pollId))
    .collect();
}

async function roundVotes(
  ctx: ReadCtx,
  poll: Doc<"polls">,
  round: "initial" | "runoff",
) {
  const memberIds = await clubMemberIds(ctx, poll.clubId);
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- at most one ballot per member in this round
  const votes = await ctx.db
    .query("votes")
    .withIndex("pollRound", (q) => q.eq("pollId", poll._id).eq("round", round))
    .collect();
  return votes.filter((vote) => memberIds.includes(vote.userId));
}

export const start = mutation({
  args: { clubId: v.id("clubs"), method: v.optional(votingMethod) },
  returns: v.id("polls"),
  handler: async (ctx, args) => {
    const user = await requireParticipant(ctx, args.clubId);
    if (await openPoll(ctx, args.clubId))
      throw new ConvexError("There's already a poll in progress.");
    const latest = await latestPoll(ctx, args.clubId);
    if (latest?.winnerNominationId && !(await bookForPoll(ctx, latest._id))) {
      throw new ConvexError(
        "Set up and start the winning book before opening another poll.",
      );
    }
    return await ctx.db.insert("polls", {
      clubId: args.clubId,
      createdBy: user._id,
      status: "nominating",
      method: args.method ?? "ranked",
      ballotVersion: 0,
    });
  },
});

export const nominate = mutation({
  args: {
    pollId: v.id("polls"),
    title: v.string(),
    author: v.optional(v.string()),
    punishment: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { poll, user } = await getPollForMember(ctx, args.pollId);
    if (poll.status !== "nominating")
      throw new ConvexError("Nominations are closed.");
    const title = args.title.trim();
    if (!title || title.length > 300 || (args.author?.length ?? 0) > 300)
      throw new ConvexError(
        "Enter a book title and author of at most 300 characters each.",
      );
    const nominations = await pollNominations(ctx, poll._id);
    if (nominations.filter((n) => n.suggestedBy === user._id).length >= 2) {
      throw new ConvexError(
        "You already have 2 nominations — withdraw one first.",
      );
    }
    const normalize = (s: string) =>
      s.trim().replace(/\s+/g, " ").toLowerCase();
    if (
      nominations.some(
        (n) =>
          normalize(n.title) === normalize(title) &&
          normalize(n.author ?? "") === normalize(args.author ?? ""),
      )
    ) {
      throw new ConvexError("That book has already been nominated.");
    }
    await ctx.db.insert("nominations", {
      pollId: poll._id,
      title,
      author: args.author?.trim() || undefined,
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
    if (!nomination) throw new ConvexError("Nomination not found.");
    const { poll, user } = await getPollForMember(ctx, nomination.pollId);
    if (poll.status !== "nominating")
      throw new ConvexError("Nominations are closed.");
    if (nomination.suggestedBy !== user._id)
      throw new ConvexError("You can only withdraw your own nomination.");
    await ctx.db.delete("nominations", nomination._id);
    return null;
  },
});

export const closeNominations = mutation({
  args: { pollId: v.id("polls") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { poll, user } = await getPollForMember(ctx, args.pollId);
    await requireOrganizer(ctx, poll, user._id);
    if (poll.status !== "nominating")
      throw new ConvexError("Nominations are already closed.");
    const nominations = await pollNominations(ctx, poll._id);
    if (nominations.length < 2)
      throw new ConvexError("Need at least two nominations to vote.");
    const members = await clubMemberIds(ctx, poll.clubId);
    if (members.some((id) => nominations.every((n) => n.suggestedBy === id))) {
      throw new ConvexError(
        "Need nominations from at least two members so everyone can support someone else's book.",
      );
    }
    // Draw once, before any votes. This published order breaks cutoff/elimination
    // ties without admitting a third finalist or favoring the earliest nominator.
    const draw = nominations.map((n) => n._id);
    for (let i = draw.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [draw[i], draw[j]] = [draw[j], draw[i]];
    }
    await ctx.db.patch("polls", poll._id, {
      status: "voting",
      tieBreakOrder: draw,
      ballotVersion: (poll.ballotVersion ?? 0) + 1,
    });
    return null;
  },
});

function checkRound(poll: Doc<"polls">, version: number | undefined) {
  if (poll.status !== "voting" && poll.status !== "runoff")
    throw new ConvexError("Voting isn't open.");
  if (version !== (poll.ballotVersion ?? 0))
    throw new ConvexError(
      "The round has changed. Review the new ballot before voting.",
    );
}

export const castVote = mutation({
  args: {
    pollId: v.id("polls"),
    nominationIds: v.array(v.id("nominations")),
    ballotVersion: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { poll, user } = await getPollForMember(ctx, args.pollId);
    checkRound(poll, args.ballotVersion);
    const round = poll.status === "runoff" ? "runoff" : "initial";
    const ids = args.nominationIds;
    if (new Set(ids).size !== ids.length)
      throw new ConvexError("You can't vote for the same book twice.");
    const nominations = await pollNominations(ctx, poll._id);
    const valid =
      round === "runoff"
        ? (poll.runoffNominationIds ?? [])
        : nominations.map((n) => n._id);
    if (ids.some((id) => !valid.includes(id)))
      throw new ConvexError("That book isn't on the ballot.");
    if (round === "runoff") {
      if (ids.length !== 1)
        throw new ConvexError("The runoff is a single vote.");
    } else {
      const max = poll.method === "ranked" ? nominations.length : 2;
      if (ids.length < 1 || ids.length > max)
        throw new ConvexError(`Choose between 1 and ${max} books.`);
      if (
        !ids.some(
          (id) =>
            nominations.find((n) => n._id === id)!.suggestedBy !== user._id,
        )
      ) {
        throw new ConvexError(
          "Include at least one book nominated by someone else.",
        );
      }
    }
    const existing = await ctx.db
      .query("votes")
      .withIndex("pollRoundUser", (q) =>
        q.eq("pollId", poll._id).eq("round", round).eq("userId", user._id),
      )
      .unique();
    if (existing)
      await ctx.db.patch("votes", existing._id, { nominationIds: ids });
    else
      await ctx.db.insert("votes", {
        pollId: poll._id,
        round,
        userId: user._id,
        nominationIds: ids,
      });
    const memberIds = await clubMemberIds(ctx, poll.clubId);
    const votes = await roundVotes(ctx, poll, round);
    if (memberIds.every((id) => votes.some((vote) => vote.userId === id)))
      await tallyRound(ctx, poll, round);
    return null;
  },
});

export const closeRound = mutation({
  args: { pollId: v.id("polls"), ballotVersion: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { poll, user } = await getPollForMember(ctx, args.pollId);
    await requireOrganizer(ctx, poll, user._id);
    checkRound(poll, args.ballotVersion);
    const round = poll.status === "runoff" ? "runoff" : "initial";
    if (!(await roundVotes(ctx, poll, round)).length)
      throw new ConvexError("Nobody has voted yet.");
    await tallyRound(ctx, poll, round);
    return null;
  },
});

async function tallyRound(
  ctx: MutationCtx,
  poll: Doc<"polls">,
  round: "initial" | "runoff",
) {
  const votes = await roundVotes(ctx, poll, round);
  const nominations = await pollNominations(ctx, poll._id);
  const candidates = nominations.map((n) => n._id);
  const draw = poll.tieBreakOrder ?? candidates; // Stable fallback for legacy polls.
  const ballots = votes.map((vote) => vote.nominationIds);
  const results = [...(poll.results ?? [])];
  let winner: Id<"nominations"> | null = null;
  let finalists: Id<"nominations">[] = [];
  if (round === "initial" && poll.method === "ranked") {
    const ranked = rankedChoice(candidates, ballots, draw);
    winner = ranked.winner;
    finalists = ranked.finalists;
    results.push(...ranked.results);
  } else {
    const slate =
      round === "initial" ? candidates : (poll.runoffNominationIds ?? []);
    const counts = orderCounts(countVotes(slate, ballots), draw);
    const result: Result = {
      label:
        round === "initial"
          ? "First round"
          : `Runoff ${results.filter((r) => r.label.startsWith("Runoff")).length + 1}`,
      counts,
      exhaustedBallots: 0,
      tieBreakUsed: false,
    };
    results.push(result);
    if (round === "initial") {
      finalists = counts.slice(0, 2).map((c) => c.nominationId);
      result.tieBreakUsed =
        counts.length > 2 && counts[1].votes === counts[2].votes;
    } else if (counts[0].votes > counts[1]?.votes) {
      winner = counts[0].nominationId;
    } else {
      finalists = counts.slice(0, 2).map((c) => c.nominationId);
      // Include stale legacy ghost ballots in cleanup so they cannot reappear.
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- one ballot per club member in this runoff
      const allVotes = await ctx.db
        .query("votes")
        .withIndex("pollRound", (q) =>
          q.eq("pollId", poll._id).eq("round", "runoff"),
        )
        .collect();
      for (const vote of allVotes) await ctx.db.delete("votes", vote._id);
    }
  }
  await ctx.db.patch("polls", poll._id, {
    status: winner ? "done" : "runoff",
    winnerNominationId: winner ?? undefined,
    runoffNominationIds: winner ? poll.runoffNominationIds : finalists,
    results,
    ballotVersion: (poll.ballotVersion ?? 0) + 1,
  });
}

async function winningNomination(
  ctx: MutationCtx,
  poll: Doc<"polls">,
  userId: Id<"users">,
) {
  if (poll.status !== "done" || !poll.winnerNominationId)
    throw new ConvexError("This poll hasn't picked a winner yet.");
  const winner = await ctx.db.get("nominations", poll.winnerNominationId);
  if (!winner) throw new ConvexError("Winning nomination is missing.");
  if (winner.suggestedBy !== userId)
    throw new ConvexError(
      "Only the member who nominated the winner can set up and start it.",
    );
  return winner;
}

function validateSetup(setup: { sectionTitles: string[]; punishment: string }) {
  if (!setup.punishment.trim() || setup.punishment.length > 2000)
    throw new ConvexError("Set a punishment of up to 2,000 characters.");
  if (
    !setup.sectionTitles.length ||
    setup.sectionTitles.length > 200 ||
    setup.sectionTitles.some((s) => !s.trim() || s.length > 300)
  ) {
    throw new ConvexError(
      "Add 1–200 named sections, up to 300 characters each.",
    );
  }
}

export const saveWinningBookSetup = mutation({
  args: {
    pollId: v.id("polls"),
    sectionTitles: v.array(v.string()),
    punishment: v.string(),
    rotation: v.optional(v.array(v.id("users"))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { poll, user } = await getPollForMember(ctx, args.pollId);
    await winningNomination(ctx, poll, user._id);
    if (await bookForPoll(ctx, poll._id))
      throw new ConvexError("The winning book has already started.");
    validateSetup(args);
    if (args.rotation) {
      const members = await clubMemberIds(ctx, poll.clubId);
      if (
        args.rotation.length !== members.length ||
        new Set(args.rotation).size !== members.length ||
        args.rotation.some((id) => !members.includes(id))
      ) {
        throw new ConvexError(
          "The rotation must include each active member exactly once.",
        );
      }
    }
    await ctx.db.patch("polls", poll._id, {
      setup: {
        sectionTitles: args.sectionTitles.map((s) => s.trim()),
        punishment: args.punishment.trim(),
        rotation: args.rotation,
      },
    });
    return null;
  },
});

/** Starting the reading clock is separate from winning and preparing the book. */
export const startWinningBook = mutation({
  args: {
    pollId: v.id("polls"),
  },
  returns: v.id("books"),
  handler: async (ctx, args) => {
    const { poll, user } = await getPollForMember(ctx, args.pollId);
    const winner = await winningNomination(ctx, poll, user._id);
    const existing = await bookForPoll(ctx, poll._id);
    if (existing) return existing._id; // A retried start can never start the book twice.
    if (!poll.setup)
      throw new ConvexError(
        "Save the sections and punishment before starting the winning book.",
      );
    validateSetup(poll.setup);
    return await startBookHelper(ctx, {
      clubId: poll.clubId,
      title: winner.title,
      author: winner.author,
      suggestedBy: winner.suggestedBy,
      ...poll.setup,
      pollId: poll._id,
    });
  },
});

export const state = query({
  args: { clubId: v.id("clubs") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("polls"),
      status: pollStatus,
      method: votingMethod,
      ballotVersion: v.number(),
      viewerId: v.id("users"),
      canParticipate: v.boolean(),
      canManage: v.boolean(),
      clubIsReading: v.boolean(),
      startedBookId: v.union(v.id("books"), v.null()),
      setup: v.union(bookSetup, v.null()),
      results: v.array(pollResult),
      tieBreakOrder: v.array(v.id("nominations")),
      nominations: v.array(
        v.object({
          _id: v.id("nominations"),
          title: v.string(),
          author: v.union(v.string(), v.null()),
          punishment: v.union(v.string(), v.null()),
          suggestedBy: v.id("users"),
          suggestedByName: v.string(),
          mine: v.boolean(),
          inRunoff: v.boolean(),
          isWinner: v.boolean(),
        }),
      ),
      myNominationCount: v.number(),
      myVote: v.union(v.array(v.id("nominations")), v.null()),
      votesCast: v.number(),
      memberCount: v.number(),
      winnerNominationId: v.union(v.id("nominations"), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const viewer = await requireMembership(ctx, args.clubId);
    const poll =
      (await openPoll(ctx, args.clubId)) ??
      (await latestPoll(ctx, args.clubId));
    if (!poll) return null;
    const memberIds = await clubMemberIds(ctx, args.clubId);
    const nominations = await pollNominations(ctx, poll._id);
    const names = new Map(
      await Promise.all(
        [...new Set(nominations.map((n) => n.suggestedBy))].map(
          async (id) =>
            [
              id,
              (await ctx.db.get("users", id))?.name ?? "Former member",
            ] as const,
        ),
      ),
    );
    const round = poll.status === "runoff" ? "runoff" : "initial";
    const votes = await roundVotes(ctx, poll, round);
    const activeBook = await ctx.db
      .query("books")
      .withIndex("clubStatus", (q) =>
        q.eq("clubId", args.clubId).eq("status", "active"),
      )
      .first();
    const startedBook = await bookForPoll(ctx, poll._id);
    const club = await ctx.db.get("clubs", args.clubId);
    const canParticipate = memberIds.includes(viewer._id);
    return {
      _id: poll._id,
      status: poll.status,
      method: poll.method ?? "approval",
      ballotVersion: poll.ballotVersion ?? 0,
      viewerId: viewer._id,
      canParticipate,
      canManage:
        canParticipate &&
        (poll.createdBy === viewer._id || club?.createdBy === viewer._id),
      clubIsReading: activeBook !== null,
      startedBookId: startedBook?._id ?? null,
      setup: poll.setup ?? null,
      results: poll.results ?? [],
      tieBreakOrder: poll.tieBreakOrder ?? [],
      nominations: nominations.map((n) => ({
        _id: n._id,
        title: n.title,
        author: n.author ?? null,
        punishment: n.punishment ?? null,
        suggestedBy: n.suggestedBy,
        suggestedByName: names.get(n.suggestedBy)!,
        mine: n.suggestedBy === viewer._id,
        inRunoff: poll.runoffNominationIds?.includes(n._id) ?? false,
        isWinner: poll.winnerNominationId === n._id,
      })),
      myNominationCount: nominations.filter((n) => n.suggestedBy === viewer._id)
        .length,
      myVote:
        votes.find((vote) => vote.userId === viewer._id)?.nominationIds ?? null,
      votesCast: votes.length,
      memberCount: memberIds.length,
      winnerNominationId: poll.winnerNominationId ?? null,
    };
  },
});
