import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { startBookHelper } from "./books";
import { rankedChoice } from "./lib/voting";

const modules = import.meta.glob("./**/*.ts");

async function election(method: "approval" | "ranked" = "approval") {
  const t = convexTest(schema, modules);
  const seed = await t.run(async (ctx) => {
    const users = await Promise.all(
      ["Ava", "Bo", "Cy", "Dee", "Ghost", "Outsider"].map((name) =>
        ctx.db.insert("users", { name }),
      ),
    );
    const clubId = await ctx.db.insert("clubs", {
      name: "Readers",
      createdBy: users[0],
    });
    for (const [i, userId] of users.entries()) {
      if (i < 5)
        await ctx.db.insert("memberships", {
          clubId,
          userId,
          ...(i === 4 ? { role: "ghost" as const } : {}),
        });
    }
    return { users, clubId };
  });
  const as = (i: number) => t.withIdentity({ subject: seed.users[i] });
  const pollId = await as(0).mutation(api.polls.start, {
    clubId: seed.clubId,
    method,
  });
  const state = () =>
    as(0)
      .query(api.polls.state, { clubId: seed.clubId })
      .then((p) => p!);
  const nominate = (i: number, title: string) =>
    as(i).mutation(api.polls.nominate, { pollId, title });
  const vote = async (i: number, nominationIds: Id<"nominations">[]) =>
    as(i).mutation(api.polls.castVote, {
      pollId,
      nominationIds,
      ballotVersion: (await state()).ballotVersion,
    });
  const close = async () =>
    as(0).mutation(api.polls.closeRound, {
      pollId,
      ballotVersion: (await state()).ballotVersion,
    });
  const slate = async () => {
    await nominate(0, "A");
    await nominate(1, "B");
    await nominate(2, "C");
    const ids = (await state()).nominations.map((n) => n._id);
    await as(0).mutation(api.polls.closeNominations, { pollId });
    // Fixed published draw makes all tie tests deterministic.
    await t.run((ctx) => ctx.db.patch("polls", pollId, { tieBreakOrder: ids }));
    return ids;
  };
  return { t, ...seed, as, pollId, state, nominate, vote, close, slate };
}

describe("book selection", () => {
  test("new polls default to ranked choice", async () => {
    const e = await election();
    const clubId = await e.as(0).mutation(api.clubs.create, { name: "Ranked readers" });
    await e.as(0).mutation(api.polls.start, { clubId });
    expect((await e.as(0).query(api.polls.state, { clubId }))?.method).toBe("ranked");
  });

  test("two nominations, no stakes yet, owner withdrawal, duplicate prevention", async () => {
    const e = await election();
    await e.nominate(0, " A ");
    await e.nominate(0, "B");
    await expect(e.nominate(0, "C")).rejects.toThrow("2 nominations");
    await expect(e.nominate(1, " a ")).rejects.toThrow(
      "already been nominated",
    );
    const id = (await e.state()).nominations[0]._id;
    await expect(
      e.as(1).mutation(api.polls.withdrawNomination, { nominationId: id }),
    ).rejects.toThrow("your own");
    await e.as(0).mutation(api.polls.withdrawNomination, { nominationId: id });
    await e.nominate(0, "C");
    expect((await e.state()).nominations.map((n) => n.title)).toEqual([
      "B",
      "C",
    ]);
    expect(
      (await e.state()).nominations.every((n) => n.punishment === null),
    ).toBe(true);
  });

  test("read isolation, authentication, and ghosts as spectators", async () => {
    const e = await election();
    await expect(
      e.t.query(api.polls.state, { clubId: e.clubId }),
    ).rejects.toThrow("Not signed in");
    await expect(
      e.as(5).query(api.polls.state, { clubId: e.clubId }),
    ).rejects.toThrow("not a member");
    await expect(e.nominate(5, "Sneak")).rejects.toThrow("not a member");
    await expect(e.nominate(4, "Ghost")).rejects.toThrow("Only active");
    const ghost = await e.as(4).query(api.polls.state, { clubId: e.clubId });
    expect(ghost?.canParticipate).toBe(false);
    expect(ghost?.memberCount).toBe(4);
    await expect(
      e.as(4).mutation(api.polls.start, { clubId: e.clubId }),
    ).rejects.toThrow("Only active");
    const ids = await e.slate();
    await expect(e.vote(4, [ids[0]])).rejects.toThrow("Only active");
    await e.vote(1, [ids[0]]);
    expect(
      (await e.as(2).query(api.polls.state, { clubId: e.clubId }))?.myVote,
    ).toBeNull();
    expect((await e.state()).results).toEqual([]);
  });

  test("nominations stay open until organizer closes, and need someone else's option", async () => {
    const e = await election();
    await expect(
      e.as(0).mutation(api.polls.closeNominations, { pollId: e.pollId }),
    ).rejects.toThrow("at least two");
    await e.nominate(0, "A");
    await e.nominate(0, "B");
    await expect(
      e.as(0).mutation(api.polls.closeNominations, { pollId: e.pollId }),
    ).rejects.toThrow("at least two members");
    await e.nominate(1, "C");
    await expect(
      e.as(1).mutation(api.polls.closeNominations, { pollId: e.pollId }),
    ).rejects.toThrow("organizer");
    await e.as(0).mutation(api.polls.closeNominations, { pollId: e.pollId });
    await expect(e.nominate(2, "D")).rejects.toThrow("closed");
    await expect(
      e.as(0).mutation(api.polls.start, { clubId: e.clubId }),
    ).rejects.toThrow("already a poll");
  });

  test("initial ballot requires another member's book; updates replace the ballot", async () => {
    const e = await election();
    const [a, b, c] = await e.slate();
    await expect(e.vote(0, [])).rejects.toThrow("between 1 and 2");
    await expect(e.vote(0, [a])).rejects.toThrow("someone else");
    await expect(e.vote(0, [a, b, c])).rejects.toThrow("between 1 and 2");
    await expect(e.vote(0, [b, b])).rejects.toThrow("same book twice");
    await e.vote(0, [a, b]);
    await e.vote(0, [c]);
    expect((await e.state()).myVote).toEqual([c]);
    expect((await e.state()).votesCast).toBe(1);
    await expect(
      e
        .as(1)
        .mutation(api.polls.closeRound, { pollId: e.pollId, ballotVersion: 1 }),
    ).rejects.toThrow("organizer");
  });

  test("two own nominations cannot fill an approval ballot", async () => {
    const e = await election();
    await e.nominate(0, "A");
    await e.nominate(0, "B");
    await e.nominate(1, "C");
    const ids = (await e.state()).nominations.map((n) => n._id);
    await e.as(0).mutation(api.polls.closeNominations, { pollId: e.pollId });
    await expect(e.vote(0, ids.slice(0, 2))).rejects.toThrow("someone else");
  });

  test("foreign poll candidates and stale submissions are refused", async () => {
    const e = await election();
    const [a, b] = await e.slate();
    const foreignId = await e.t.run(async (ctx) => {
      const pollId = await ctx.db.insert("polls", {
        clubId: e.clubId,
        createdBy: e.users[0],
        status: "done",
      });
      return await ctx.db.insert("nominations", {
        pollId,
        title: "Foreign",
        suggestedBy: e.users[1],
      });
    });
    await expect(e.vote(0, [foreignId])).rejects.toThrow("isn't on the ballot");
    await e.vote(0, [b]);
    await e.vote(1, [a]);
    await e.close();
    await expect(
      e.as(0).mutation(api.polls.castVote, {
        pollId: e.pollId,
        nominationIds: [a],
        ballotVersion: 1,
      }),
    ).rejects.toThrow("round has changed");
    await expect(
      e
        .as(0)
        .mutation(api.polls.closeRound, { pollId: e.pollId, ballotVersion: 1 }),
    ).rejects.toThrow("round has changed");
  });

  test("all active members auto-close each round; exactly two finalists and no automatic book", async () => {
    const e = await election();
    const [a, b, c] = await e.slate();
    await e.vote(0, [b]);
    await e.vote(1, [a]);
    await e.vote(2, [a, b]);
    await e.vote(3, [c]);
    let p = await e.state();
    expect(p.status).toBe("runoff");
    expect(p.nominations.filter((n) => n.inRunoff).map((n) => n._id)).toEqual([
      a,
      b,
    ]);
    expect(p.myVote).toBeNull();
    expect(p.votesCast).toBe(0);
    await expect(e.vote(0, [c])).rejects.toThrow("isn't on the ballot");
    await expect(e.vote(0, [a, b])).rejects.toThrow("single vote");
    await e.vote(0, [a]);
    await e.vote(1, [a]);
    await e.vote(2, [a]);
    await e.vote(3, [b]);
    p = await e.state();
    expect(p.status).toBe("done");
    expect(p.winnerNominationId).toBe(a);
    expect(p.startedBookId).toBeNull();
    expect(p.setup).toBeNull();
    expect(p.results.at(-1)?.counts[0].votes).toBe(3);
  });

  test("ties at the cutoff use the published draw and a tied final starts a clean vote", async () => {
    const e = await election();
    const [a, b, c] = await e.slate();
    await e.vote(0, [b]);
    await e.vote(1, [c]);
    await e.vote(2, [a]);
    await e.close();
    let p = await e.state();
    expect(p.nominations.filter((n) => n.inRunoff).map((n) => n._id)).toEqual([
      a,
      b,
    ]);
    expect(p.results[0].tieBreakUsed).toBe(true);
    await e.vote(0, [a]);
    await e.vote(1, [b]);
    await e.close();
    p = await e.state();
    expect(p.status).toBe("runoff");
    expect(p.ballotVersion).toBe(3);
    expect(p.myVote).toBeNull();
    expect(p.votesCast).toBe(0);
    expect(p.results.at(-1)?.counts.map((c) => c.votes)).toEqual([1, 1]);
    await e.vote(0, [b]);
    await e.close();
    expect((await e.state()).winnerNominationId).toBe(b);
  });

  test("no tally without votes, and a removed member's ballot is excluded", async () => {
    const e = await election();
    const [a] = await e.slate();
    await expect(e.close()).rejects.toThrow("Nobody has voted");
    await e.vote(1, [a]);
    await e.t.run(async (ctx) => {
      const m = await ctx.db
        .query("memberships")
        .withIndex("clubUser", (q) =>
          q.eq("clubId", e.clubId).eq("userId", e.users[1]),
        )
        .unique();
      await ctx.db.patch("memberships", m!._id, { role: "ghost" });
    });
    expect((await e.state()).votesCast).toBe(0);
    await expect(e.close()).rejects.toThrow("Nobody has voted");
  });

  test("ranked ballots keep order and transfer votes, with a stored count history", async () => {
    const e = await election("ranked");
    const [a, b, c] = await e.slate();
    await expect(e.vote(0, [a])).rejects.toThrow("someone else");
    await e.vote(0, [a, b, c]);
    await e.vote(1, [b, a]);
    await e.vote(2, [c, b]);
    await e.vote(3, [b]);
    const p = await e.state();
    expect(p.status).toBe("done");
    expect(p.winnerNominationId).toBe(b);
    expect(p.results.length).toBe(2);
    expect(p.results[0].eliminatedNominationId).toBe(c);
    expect(p.results[0].tieBreakUsed).toBe(true);
    expect(p.results[1].counts[0].votes).toBe(3);
    expect(p.startedBookId).toBeNull();
  });

  test("a ranked final tie opens a fresh two-book runoff", async () => {
    const e = await election("ranked");
    const [a, b, c] = await e.slate();
    await e.vote(0, [b]);
    await e.vote(1, [a]);
    await e.vote(2, [a]);
    await e.vote(3, [b]);
    const p = await e.state();
    expect(p.status).toBe("runoff");
    expect(p.nominations.filter((n) => n.inRunoff).map((n) => n._id)).toEqual([
      a,
      b,
    ]);
    expect(p.results[0].eliminatedNominationId).toBe(c);
    expect(p.votesCast).toBe(0);
  });

  test("only winning nominator can prepare; finish current book before starting; repeated start is idempotent", async () => {
    const e = await election();
    const [a, b] = await e.slate();
    await e.vote(0, [b]);
    await e.vote(1, [a]);
    await e.close();
    await e.vote(1, [a]);
    await e.close();
    const args = {
      pollId: e.pollId,
      sectionTitles: [" Part 1 ", "Part 2"],
      punishment: " Sing ",
    };
    await expect(
      e.as(1).mutation(api.polls.saveWinningBookSetup, args),
    ).rejects.toThrow("Only the member who nominated");
    await expect(
      e.as(1).mutation(api.polls.startWinningBook, { pollId: e.pollId }),
    ).rejects.toThrow("Only the member who nominated");
    await expect(
      e.as(0).mutation(api.polls.startWinningBook, { pollId: e.pollId }),
    ).rejects.toThrow("Save the sections");
    await expect(
      e.as(0).mutation(api.polls.saveWinningBookSetup, {
        ...args,
        sectionTitles: [" "],
      }),
    ).rejects.toThrow("named sections");
    await expect(
      e
        .as(0)
        .mutation(api.polls.saveWinningBookSetup, { ...args, punishment: " " }),
    ).rejects.toThrow("punishment");
    await expect(
      e.as(0).mutation(api.polls.saveWinningBookSetup, {
        ...args,
        rotation: [e.users[4]],
      }),
    ).rejects.toThrow("each active member");
    const old = await e.t.run((ctx) => startBookHelper(ctx, {
      clubId: e.clubId,
      title: "Current",
      punishment: "Old stakes",
      sectionTitles: ["Last part"],
    }));
    await expect(
      e.as(1).mutation(api.books.start, {
        clubId: e.clubId,
        title: "A",
        sectionTitles: ["Chapter 1"],
        punishment: "Bypass",
      }),
    ).rejects.toThrow("Finish book selection");
    await e.as(0).mutation(api.polls.saveWinningBookSetup, args);
    expect((await e.state()).setup?.sectionTitles).toEqual([
      "Part 1",
      "Part 2",
    ]);
    expect((await e.state()).clubIsReading).toBe(true);
    await expect(
      e.as(0).mutation(api.polls.startWinningBook, { pollId: e.pollId }),
    ).rejects.toThrow("already reading");
    await expect(
      e.as(0).mutation(api.polls.start, { clubId: e.clubId }),
    ).rejects.toThrow("winning book");
    await e.t.run((ctx) => ctx.db.patch("books", old, { status: "finished" }));
    const bookId = await e
      .as(0)
      .mutation(api.polls.startWinningBook, { pollId: e.pollId });
    const book = await e.t.run((ctx) => ctx.db.get("books", bookId));
    expect(book).toMatchObject({
      title: "A",
      suggestedBy: e.users[0],
      punishment: "Sing",
      pollId: e.pollId,
      rotation: e.users.slice(0, 4),
    });
    const sections = await e.t.run((ctx) =>
      ctx.db
        .query("sections")
        .withIndex("bookIdx", (q) => q.eq("bookId", bookId))
        .take(3),
    );
    expect(sections.map((s) => s.title)).toEqual(["Part 1", "Part 2"]);
    expect(sections[0].dueDay).toBeDefined();
    expect(sections[1].dueDay).toBeUndefined();
    await expect(
      e.as(0).mutation(api.polls.saveWinningBookSetup, args),
    ).rejects.toThrow("already started");
    await e.t.run((ctx) =>
      ctx.db.patch("books", bookId, { status: "finished" }),
    );
    expect(
      await e.as(0).mutation(api.polls.startWinningBook, { pollId: e.pollId }),
    ).toBe(bookId);
    const next = await e
      .as(0)
      .mutation(api.polls.start, { clubId: e.clubId, method: "ranked" });
    expect(next).not.toBe(e.pollId);
  });

  test("legacy completed polls find the consumed book and allow another election", async () => {
    const e = await election();
    await e.nominate(0, "Legacy");
    const nomination = (await e.state()).nominations[0]._id;
    await e.t.run(async (ctx) => {
      await ctx.db.patch("polls", e.pollId, {
        status: "done",
        winnerNominationId: nomination,
        method: undefined,
        ballotVersion: undefined,
      });
      await ctx.db.insert("books", {
        clubId: e.clubId,
        pollId: e.pollId,
        title: "Legacy",
        punishment: "Sing",
        status: "finished",
        rotation: e.users.slice(0, 4),
        startedDay: "2026-01-01",
      });
    });
    const p = await e.state();
    expect(p.method).toBe("approval");
    expect(p.startedBookId).not.toBeNull();
    await expect(
      e.as(0).mutation(api.polls.start, { clubId: e.clubId }),
    ).resolves.toBeDefined();
  });
});

describe("ranked count", () => {
  const [a, b, c, d] = ["a", "b", "c", "d"] as Id<"nominations">[];
  test("first-choice majority needs no elimination", () => {
    const r = rankedChoice([a, b, c], [[a], [a], [b]], [a, b, c]);
    expect(r.winner).toBe(a);
    expect(r.results).toHaveLength(1);
  });
  test("partial ballots exhaust; majority is of remaining votes", () => {
    const r = rankedChoice(
      [a, b, c, d],
      [[a], [a], [b], [c], [d]],
      [a, b, c, d],
    );
    expect(r.winner).toBe(a);
    expect(r.results.at(-1)?.exhaustedBallots).toBe(2);
  });
  test("a trailing candidate wins on transfers", () => {
    const r = rankedChoice(
      [a, b, c],
      [[a], [a], [a], [b], [b], [c, b], [c, b]],
      [a, b, c],
    );
    expect(r.results[0].counts[0].nominationId).toBe(a);
    expect(r.winner).toBe(b);
    expect(r.results.at(-1)?.counts[0].votes).toBe(4);
  });
});
