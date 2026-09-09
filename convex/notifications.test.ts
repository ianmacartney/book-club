import pushTest from "@convex-dev/expo-push-notifications/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { startBookHelper } from "./books";
import { push } from "./notifications";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function reading() {
  const t = convexTest(schema, modules);
  pushTest.register(t);
  const seed = await t.run(async (ctx) => {
    const peter = await ctx.db.insert("users", { name: "Peter" });
    const reader = await ctx.db.insert("users", { name: "Next reader" });
    const tucker = await ctx.db.insert("users", { name: "Tucker" });
    const clubId = await ctx.db.insert("clubs", {
      name: "Club",
      createdBy: peter,
    });
    for (const userId of [peter, reader, tucker]) {
      await ctx.db.insert("memberships", { clubId, userId });
    }
    const bookId = await startBookHelper(ctx, {
      clubId,
      title: "The Odyssey",
      punishment: "karaoke",
      sectionTitles: ["Book 20", "Book 21"],
      rotation: [peter, reader],
    });
    const sections = await ctx.db
      .query("sections")
      .withIndex("bookIdx", (q) => q.eq("bookId", bookId))
      .take(2);
    return { peter, reader, tucker, sections };
  });
  return { t, ...seed };
}

// Inspect and drive delivery explicitly; never contact Expo in these tests.
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("submission notifications", () => {
  test("saves first, then skips a missing token while notifying registered readers", async () => {
    const r = await reading();
    await r.t
      .withIdentity({ subject: r.reader })
      .mutation(api.notifications.registerPushToken, {
        token: "ExponentPushToken[test-reader]",
      });
    const errors = vi.spyOn(console, "error");
    await r.t
      .withIdentity({ subject: r.peter })
      .mutation(api.books.submitSection, {
        sectionId: r.sections[0]._id,
        quotes: "A long enough quotation to save in the club's deck.",
        thoughts: "Peter's summary",
      });

    const beforeDelivery = await r.t.run(async (ctx) => ({
      section: await ctx.db.get("sections", r.sections[0]._id),
      next: await ctx.db.get("sections", r.sections[1]._id),
      jobs: await ctx.db.system.query("_scheduled_functions").take(10),
      notifications: await push.getNotificationsForUser(ctx, {
        userId: r.reader,
      }),
    }));
    expect(beforeDelivery.section?.submission?.thoughts).toBe(
      "Peter's summary",
    );
    expect(beforeDelivery.next?.dueDay).toEqual(expect.any(String));
    expect(beforeDelivery.notifications).toEqual([]);
    expect(beforeDelivery.jobs).toHaveLength(1);
    expect(beforeDelivery.jobs[0].name).toBe("notifications:deliverBatch");

    await r.t.mutation(
      internal.notifications.deliverBatch,
      beforeDelivery.jobs[0].args[0],
    );
    const sent = await r.t.run(async (ctx) => ({
      reader: await push.getNotificationsForUser(ctx, { userId: r.reader }),
      tucker: await push.getNotificationsForUser(ctx, { userId: r.tucker }),
    }));
    expect(sent.reader).toHaveLength(1);
    expect(sent.reader[0].body).toBe("Peter's summary");
    expect(sent.tucker).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
  });

  test("a push component failure cannot undo the submitted text, quotes, or next deadline", async () => {
    const r = await reading();
    await r.t
      .withIdentity({ subject: r.reader })
      .mutation(api.notifications.registerPushToken, {
        token: "ExponentPushToken[test-reader]",
      });
    const send = vi
      .spyOn(push, "sendPushNotificationBatch")
      .mockRejectedValue(new Error("push service unavailable"));
    const quote = "A long enough quotation to save in the club's deck.";
    await r.t
      .withIdentity({ subject: r.peter })
      .mutation(api.books.submitSection, {
        sectionId: r.sections[0]._id,
        quotes: quote,
        thoughts: "Keep this submission",
      });
    expect(send).not.toHaveBeenCalled();
    const [job] = await r.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").take(1),
    );
    await expect(
      r.t.mutation(internal.notifications.deliverBatch, job.args[0]),
    ).rejects.toThrow("push service unavailable");

    const saved = await r.t.run(async (ctx) => ({
      section: await ctx.db.get("sections", r.sections[0]._id),
      next: await ctx.db.get("sections", r.sections[1]._id),
      quotes: await ctx.db
        .query("quotes")
        .withIndex("section", (q) => q.eq("sectionId", r.sections[0]._id))
        .take(10),
    }));
    expect(saved.section?.submission?.thoughts).toBe("Keep this submission");
    expect(saved.next?.dueDay).toEqual(expect.any(String));
    expect(saved.quotes.map((q) => q.text)).toEqual([quote]);
  });
});
