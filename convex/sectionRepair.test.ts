import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import { startBookHelper } from "./books";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const grouped = [
  "Peter. 1-2, 11-12, … , 61-62",
  "Billy. 3-4, 13-14, … , 53-54",
  "Henry. 5-6, 15-16, … , 55-56",
  "Ian M. 7-8, 17-18, … , 57-58",
  "Ian S. 9-10, 19-20, … , 59-60",
];
const titles = Array.from(
  { length: 31 },
  (_, i) => `${i * 2 + 1}–${i * 2 + 2}`,
);

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const rotation = [];
    for (const name of ["Ian M", "Ian S", "Billy", "Henry", "Peter"]) {
      rotation.push(await ctx.db.insert("users", { name }));
    }
    const clubId = await ctx.db.insert("clubs", {
      name: "Club",
      createdBy: rotation[0],
    });
    for (const userId of rotation)
      await ctx.db.insert("memberships", { clubId, userId });
    const pollId = await ctx.db.insert("polls", {
      clubId,
      createdBy: rotation[4],
      status: "done",
      setup: { sectionTitles: grouped, punishment: "Sing", rotation },
    });
    const bookId = await startBookHelper(ctx, {
      clubId,
      pollId,
      title: "Theo of Golden",
      punishment: "Sing",
      sectionTitles: grouped,
      rotation,
      startedDay: "2026-09-29",
    });
    return { bookId, pollId, rotation };
  });
  const read = () =>
    t.run(async (ctx) => ({
      book: await ctx.db.get("books", ids.bookId),
      poll: await ctx.db.get("polls", ids.pollId),
      sections: await ctx.db
        .query("sections")
        .withIndex("bookIdx", (q) => q.eq("bookId", ids.bookId))
        .take(201),
      jobs: await ctx.db.system.query("_scheduled_functions").take(10),
    }));
  return {
    t,
    ...ids,
    read,
    args: {
      bookId: ids.bookId,
      expectedTitles: grouped,
      sectionTitles: titles,
    },
  };
}

test("previews and expands five grouped rows into 31 ranges without changing the reading clock or rotation", async () => {
  const r = await fixture();
  const before = await r.read();
  const preview = await r.t.mutation(internal.setup.expandBookSections, r.args);
  expect(preview).toMatchObject({
    dryRun: true,
    changed: true,
    previousCount: 5,
  });
  expect(preview.sections.map((s) => s.title)).toEqual(titles);
  expect(await r.read()).toEqual(before);
  await r.t.mutation(internal.setup.expandBookSections, {
    ...r.args,
    dryRun: false,
  });
  const after = await r.read();
  expect(after.book).toEqual(before.book);
  expect(after.sections.map((s) => s.title)).toEqual(titles);
  expect(after.sections.map((s) => s.assignedTo)).toEqual(
    titles.map((_, i) => r.rotation[i % 5]),
  );
  expect(after.sections.slice(0, 5).map((s) => s._id)).toEqual(
    before.sections.map((s) => s._id),
  );
  expect(after.sections[0].dueDay).toBe("2026-10-01");
  expect(after.sections.slice(1).every((s) => s.dueDay === undefined)).toBe(
    true,
  );
  expect(after.poll?.setup).toEqual({
    ...before.poll?.setup,
    sectionTitles: titles,
  });
  expect(after.jobs).toEqual([]);
  expect(
    await r.t.mutation(internal.setup.expandBookSections, {
      ...r.args,
      dryRun: false,
    }),
  ).toMatchObject({ changed: false });
  expect(await r.read()).toEqual(after);
});

test.each([
  "draft",
  "submission",
  "cloud",
  "deadline",
  "stale",
  "poll",
  "finished",
])("refuses a %s conflict without partial edits", async (conflict) => {
  const r = await fixture();
  const { sections } = await r.read();
  await r.t.run(async (ctx) => {
    const writing = {
      by: r.rotation[0],
      at: Date.now(),
      quotes: "Saved quote",
      thoughts: "Saved notes",
    };
    if (conflict === "draft")
      await ctx.db.patch("sections", sections[0]._id, { draft: writing });
    if (conflict === "submission")
      await ctx.db.patch("sections", sections[0]._id, {
        submission: { ...writing, day: "2026-09-29", skip: false },
      });
    if (conflict === "cloud")
      await ctx.db.insert("clouds", {
        userId: r.rotation[0],
        sectionId: sections[0]._id,
        source: "section_late",
        day: "2026-10-02",
        count: 2,
      });
    if (conflict === "deadline")
      await ctx.db.patch("sections", sections[1]._id, { dueDay: "2026-10-03" });
    if (conflict === "stale")
      await ctx.db.patch("sections", sections[0]._id, {
        title: "An edited title",
      });
    if (conflict === "poll")
      await ctx.db.patch("polls", r.pollId, {
        setup: { sectionTitles: ["Changed"], punishment: "Sing" },
      });
    if (conflict === "finished")
      await ctx.db.patch("books", r.bookId, { status: "finished" });
  });
  const before = await r.read();
  await expect(
    r.t.mutation(internal.setup.expandBookSections, {
      ...r.args,
      dryRun: false,
    }),
  ).rejects.toThrow();
  expect(await r.read()).toEqual(before);
});

test("rejects shrinking, empty titles, and oversized repairs", async () => {
  const r = await fixture();
  for (const sectionTitles of [["One"], [""], Array(201).fill("One")]) {
    await expect(
      r.t.mutation(internal.setup.expandBookSections, {
        ...r.args,
        sectionTitles,
        dryRun: false,
      }),
    ).rejects.toThrow();
  }
  expect((await r.read()).sections.map((s) => s.title)).toEqual(grouped);
});
