/* eslint-disable @convex-dev/no-collect-in-query -- tiny isolated test fixtures */
import pushTest from "@convex-dev/expo-push-notifications/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { push } from "./notifications";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const clock = (date: string) => vi.setSystemTime(new Date(date));
beforeEach(() => {
  vi.useFakeTimers();
  clock("2026-09-01T12:00:00Z");
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function fixture(active = false, nominating = true) {
  const t = convexTest(schema, modules);
  pushTest.register(t);
  const seed = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: "Reader",
      timezone: "America/Los_Angeles",
    });
    const clubId = await ctx.db.insert("clubs", {
      name: "Club",
      createdBy: userId,
    });
    const membershipId = await ctx.db.insert("memberships", { clubId, userId });
    const bookId = await ctx.db.insert("books", {
      clubId,
      title: "Book",
      punishment: "Sing",
      rotation: [userId],
      startedDay: "2026-09-07",
      status: active ? "active" : "finished",
      ...(active
        ? {}
        : {
            endedDay: "2026-09-10",
            endedAt: Date.parse("2026-09-10T20:00:00Z"),
          }),
    });
    const pollId = await ctx.db.insert("polls", {
      clubId,
      createdBy: userId,
      status: nominating ? "nominating" : "voting",
    });
    const prefId = await ctx.db.insert("notificationPrefs", {
      userId,
      reminderTime: "18:00",
      notifyOnStars: false,
      notifyOnSubmissions: true,
    });
    return { userId, clubId, membershipId, bookId, pollId, prefId };
  });
  clock("2026-09-16T01:00:00Z"); // Tuesday 18:00 Pacific.
  const asUser = t.withIdentity({ subject: seed.userId });
  await asUser.mutation(api.notifications.registerPushToken, {
    token: "ExponentPushToken[reminder-test]",
  });
  return {
    t,
    ...seed,
    asUser,
    nominate: () =>
      t.run((ctx) =>
        ctx.db.insert("nominations", {
          pollId: seed.pollId,
          suggestedBy: seed.userId,
          title: "Next book",
        }),
      ),
    jobs: () =>
      t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect()),
    sends: () =>
      t.run((ctx) =>
        push.getNotificationsForUser(ctx, { userId: seed.userId }),
      ),
  };
}

async function scheduled(r: Awaited<ReturnType<typeof fixture>>) {
  await r.t.mutation(internal.notifications.sendReminders, {});
  return (await r.jobs()).filter(
    (j) => j.name === "notifications:deliverBatch",
  );
}

test("nomination reminder at the chosen local time during a break, once per day across settings edits", async () => {
  const r = await fixture();
  clock("2026-09-16T00:59:00Z");
  expect(await scheduled(r)).toEqual([]);
  clock("2026-09-16T01:00:00Z");
  const [job] = await scheduled(r);
  expect(job.args[0].sends[0].notification.data).toMatchObject({
    pushups: false,
    nominations: true,
    day: "2026-09-15",
  });
  await r.t.mutation(internal.notifications.deliverBatch, job.args[0]);
  expect((await r.sends())[0].title).toBe("Nominate the next book");
  await r.asUser.mutation(api.notifications.updateSettings, {
    notifyOnStars: true,
  });
  expect(await scheduled(r)).toHaveLength(1);
  clock("2026-09-17T01:00:00Z");
  expect(await scheduled(r)).toHaveLength(2);
});

test("nominations run on Sunday and stop after just one suggestion", async () => {
  const r = await fixture(true);
  clock("2026-09-14T01:00:00Z"); // Sunday Pacific.
  const [job] = await scheduled(r);
  expect(job.args[0].sends[0].notification.data).toMatchObject({
    pushups: false,
    nominations: true,
  });
  await r.nominate();
  await r.t.mutation(internal.notifications.deliverBatch, job.args[0]);
  expect(await r.sends()).toEqual([]);
});

test("push-ups and nominations share one notification, and a check-in only satisfies push-ups", async () => {
  const r = await fixture(true);
  const [job] = await scheduled(r);
  expect(job.args[0].sends).toHaveLength(1);
  expect(job.args[0].sends[0].notification.data).toMatchObject({
    pushups: true,
    nominations: true,
  });
  await r.asUser.mutation(api.pushups.submit, { status: "storm" });
  await r.t.mutation(internal.notifications.deliverBatch, job.args[0]);
  expect((await r.sends())[0].title).toBe("Nominate the next book");
});

test.each(["ghost", "off-grid", "disabled", "closed", "nominated"])(
  "no nomination nudge when %s",
  async (reason) => {
    const r = await fixture();
    await r.t.run(async (ctx) => {
      if (reason === "ghost")
        await ctx.db.patch("memberships", r.membershipId, { role: "ghost" });
      if (reason === "off-grid")
        await ctx.db.insert("offGridPeriods", {
          userId: r.userId,
          declaredBy: r.userId,
          fromDay: "2026-09-15",
          toDay: "2026-09-16",
        });
      if (reason === "disabled")
        await ctx.db.patch("notificationPrefs", r.prefId, {
          reminderTime: undefined,
        });
      if (reason === "closed")
        await ctx.db.patch("polls", r.pollId, { status: "voting" });
    });
    if (reason === "nominated") await r.nominate();
    expect(await scheduled(r)).toEqual([]);
  },
);

test.each(["finished", "abandoned", "disabled"])(
  "queued push-up reminder is discarded when %s",
  async (reason) => {
    const r = await fixture(true, false);
    const [job] = await scheduled(r);
    await r.t.run(async (ctx) => {
      if (reason === "disabled")
        await ctx.db.patch("notificationPrefs", r.prefId, {
          reminderTime: undefined,
        });
      else
        await ctx.db.patch("books", r.bookId, {
          status: reason as "finished" | "abandoned",
          endedDay: "2026-09-15",
          endedAt: Date.now(),
        });
    });
    await r.t.mutation(internal.notifications.deliverBatch, job.args[0]);
    expect(await r.sends()).toEqual([]);
  },
);

test("a push-up reminder already sent today does not suppress a newly opened nomination", async () => {
  const r = await fixture(true, false);
  await scheduled(r);
  await r.t.run((ctx) =>
    ctx.db.patch("polls", r.pollId, { status: "nominating" }),
  );
  const jobs = await scheduled(r);
  expect(jobs).toHaveLength(2);
  expect(jobs[1].args[0].sends[0].notification.data).toMatchObject({
    pushups: false,
    nominations: true,
  });
});

test("rollover catches up reading days only, including off-grid, and resumes with a new book", async () => {
  const r = await fixture();
  await r.t.run((ctx) =>
    ctx.db.insert("offGridPeriods", {
      userId: r.userId,
      declaredBy: r.userId,
      fromDay: "2026-09-09",
      toDay: "2026-09-15",
    }),
  );
  await r.t.mutation(internal.rollover.processAll, {});
  await r.t.mutation(internal.rollover.processAll, {});
  const checkins = await r.t.run((ctx) => ctx.db.query("checkins").collect());
  expect(checkins.map((c) => [c.day, c.status]).sort()).toEqual([
    ["2026-09-08", "missed"],
    ["2026-09-09", "storm"],
  ]);
  expect(await scheduled(r)).toEqual([]); // Off grid suppresses nominations too.
  await expect(
    r.asUser.mutation(api.pushups.submit, { status: "storm" }),
  ).rejects.toThrow("Between books");
  await r.t.run((ctx) =>
    ctx.db.insert("books", {
      clubId: r.clubId,
      title: "New",
      punishment: "Sing",
      rotation: [r.userId],
      status: "active",
      startedDay: "2026-09-15",
      startedAt: Date.now(),
    }),
  );
  clock("2026-09-17T01:00:00Z");
  await r.t.mutation(internal.rollover.processAll, {});
  expect(
    (await r.t.run((ctx) => ctx.db.query("checkins").collect()))
      .map((c) => c.day)
      .sort(),
  ).toEqual(["2026-09-09", "2026-09-08", "2026-09-15"].sort());
  expect(
    (await scheduled(r))[0].args[0].sends[0].notification.data.pushups,
  ).toBe(true);
  await r.asUser.mutation(api.pushups.submit, { status: "storm" });
});

test("finish day is local: preserve actual reports, excuse later silence, and leave the quote unlocked", async () => {
  const r = await fixture(true, false);
  clock("2026-09-16T04:00:00Z"); // Sep 15 Pacific, Sep 16 London.
  const london = await r.t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      name: "London",
      timezone: "Europe/London",
    });
    await ctx.db.insert("memberships", { userId: id, clubId: r.clubId });
    return id;
  });
  await r.asUser.mutation(api.pushups.submit, { status: "storm" });
  clock("2026-09-16T05:00:00Z");
  await r.asUser.mutation(api.books.abandon, { bookId: r.bookId });
  clock("2026-09-17T12:00:00Z");
  await r.t.mutation(internal.rollover.processAll, {});
  const rows = await r.t.run((ctx) => ctx.db.query("checkins").collect());
  expect(rows.filter((c) => c.userId === london)).toEqual([]);
  expect(
    rows.find((c) => c.userId === r.userId && c.day === "2026-09-15")?.status,
  ).toBe("storm");
  expect(rows.some((c) => c.day === "2026-09-16")).toBe(false);
  const home = await r.asUser.query(api.clubs.home, { clubId: r.clubId });
  expect(home.activeBookId).toBeNull();
  expect(home.members.every((m) => !m.isPushupDay)).toBe(true);
  await r.t.run(async (ctx) => {
    const quoteId = await ctx.db.insert("quotes", {
      clubId: r.clubId,
      text: "Quote during a break",
      sort: 0.1,
      hidden: false,
    });
    await ctx.db.insert("dailyQuotes", {
      clubId: r.clubId,
      day: "2026-09-17",
      quoteId,
      text: "Quote during a break",
      sort: 0.1,
    });
  });
  expect(
    await r.asUser.query(api.quotes.today, {
      clubId: r.clubId,
      viewerDay: "2026-09-17",
    }),
  ).toMatchObject({ earned: true });
});

test("repair previews and removes only break penalties; real stars, book results, and other-club obligations survive", async () => {
  const r = await fixture();
  let other: Id<"users">;
  await r.t.run(async (ctx) => {
    other = await ctx.db.insert("users", {
      name: "Other",
      timezone: "America/Los_Angeles",
    });
    await ctx.db.insert("memberships", { userId: other, clubId: r.clubId });
    const clubId = await ctx.db.insert("clubs", {
      name: "Other club",
      createdBy: other,
    });
    await ctx.db.insert("memberships", { userId: other, clubId });
    await ctx.db.insert("books", {
      clubId,
      title: "Still reading",
      rotation: [other],
      punishment: "Sing",
      status: "active",
      startedDay: "2026-09-01",
    });
    await ctx.db.patch("books", r.bookId, {
      result: {
        tallies: [{ userId: r.userId, clouds: 5 }],
        loserIds: [r.userId],
      },
    });
    for (const [userId, day, status] of [
      [r.userId, "2026-09-11", "missed"],
      [r.userId, "2026-09-12", "star"],
      [other, "2026-09-15", "missed"],
    ] as const) {
      await ctx.db.insert("checkins", { userId, day, status });
      if (status === "missed")
        await ctx.db.insert("clouds", {
          userId,
          day,
          count: 2,
          source: "pushups_missed",
        });
    }
  });
  const args = { clubId: r.clubId, fromDay: "2026-09-10", toDay: "2026-09-15" };
  const preview = await r.t.mutation(
    internal.pushups.clearBreakPenalties,
    args,
  );
  expect(preview).toMatchObject({ dryRun: true, checkins: 1, clouds: 2 });
  const feed = await r.asUser.query(api.feed.forClub, {
    clubId: r.clubId,
    from: args.fromDay,
    through: args.toDay,
  });
  expect(JSON.stringify(feed)).not.toContain('"status":"missed"');
  expect(JSON.stringify(feed)).toContain('"status":"star"');
  const history = await r.asUser.query(api.pushups.history, {});
  expect(history.find((d) => d.day === "2026-09-11")).toMatchObject({
    required: false,
    status: null,
  });
  await r.t.mutation(internal.pushups.clearBreakPenalties, {
    ...args,
    dryRun: false,
  });
  expect(
    await r.t.mutation(internal.pushups.clearBreakPenalties, args),
  ).toMatchObject({ checkins: 0, clouds: 0 });
  const kept = await r.t.run(async (ctx) => ({
    rows: await ctx.db.query("checkins").collect(),
    book: await ctx.db.get("books", r.bookId),
  }));
  expect(kept.rows).toHaveLength(2);
  expect(kept.book?.result?.tallies[0].clouds).toBe(5);
  await expect(
    r.t.mutation(internal.pushups.clearBreakPenalties, {
      ...args,
      fromDay: "2026-01-01",
    }),
  ).rejects.toThrow("32 days");
});

test("new clubs and ghosts owe no catch-up; unauthenticated users cannot check in", async () => {
  const r = await fixture();
  await r.t.run((ctx) => ctx.db.delete("books", r.bookId));
  await r.t.mutation(internal.rollover.processAll, {});
  expect(await r.t.run((ctx) => ctx.db.query("checkins").collect())).toEqual(
    [],
  );
  await expect(
    r.t.mutation(api.pushups.submit, { status: "storm" }),
  ).rejects.toThrow("Not signed in");
  await r.t.run(async (ctx) => {
    await ctx.db.insert("books", {
      clubId: r.clubId,
      title: "Active",
      punishment: "Sing",
      rotation: [r.userId],
      startedDay: "2026-09-07",
      status: "active",
    });
    await ctx.db.patch("memberships", r.membershipId, { role: "ghost" });
  });
  await r.t.mutation(internal.rollover.processAll, {});
  expect(await r.t.run((ctx) => ctx.db.query("checkins").collect())).toEqual(
    [],
  );
  await expect(
    r.asUser.mutation(api.pushups.submit, { status: "storm" }),
  ).rejects.toThrow("Ghosts owe no pushups");
});
