import { v } from "convex/values";
import { api, internal } from "../convex/_generated/api.js";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { WithoutSystemFields, defineTable } from "convex/server";
import { withSession } from "./lib/withSession.js";
import { Doc } from "./_generated/dataModel.js";
import { formatInTimeZone, utcToZonedTime } from "date-fns-tz";

const string = v.string();
const number = v.number();
const boolean = v.boolean();
const ts = v.number();
const opt = v.optional;
const l = v.literal;
const id = v.id;
const obj = v.object;
const u = v.union;
const date = v.string(); // RFC3339 %Y-%M-%D
const bigint = v.int64();
const array = v.array;
const flag = opt(boolean);

const DayMs = 24 * 60 * 60 * 1000;

function getDay(dateTs: number, timezone: string | undefined) {
  return formatInTimeZone(
    dateTs,
    timezone ?? "America/Los_Angeles",
    "yyyy-MM-dd"
  );
  // return date.toISOString().slice(0, 10);
}

function getToday(timezone: string | undefined) {
  return getDay(Date.now(), timezone);
}

export const submitPushups = mutation(
  withSession({
    args: {
      optout: flag,
    },
    handler: async ({ db, scheduler, session }, { optout }) => {
      if (!session.userId) {
        throw new Error(`Not logged in.`);
      }
      const user = (await db.get(session.userId))!;
      const day = getToday(user.timezone);
      return await db.insert("activities", {
        userId: session.userId,
        day,
        stormies: optout ? 1n : undefined,
        data: { type: "pushups", optout },
      });
    },
  })
);

export const submitChapter = mutation(
  withSession({
    args: {
      chapterId: id("chapters"),
      summary: string,
    },
    handler: async ({ db, scheduler, session }, { chapterId, summary }) => {
      if (!session.userId) {
        throw new Error(`Not logged in.`);
      }
      const user = (await db.get(session.userId))!;
      const day = getToday(user.timezone);
      const activity: WithoutSystemFields<Doc<"activities">> = {
        userId: session.userId,
        day,
        data: { type: "chapter", chapterId },
      };
      const chapter = await db.get(chapterId);
      if (!chapter) {
        throw new Error(`Chapter not found.`);
      }
      const book = (await db.get(chapter.bookId))!;
      const userIndex = book.rotation.indexOf(session.userId);
      if (userIndex === -1) {
        throw new Error(`User not in book.`);
      }
      if (chapter.summary) {
        throw new Error(`Chapter already submitted.`);
      }
      await db.patch(chapter._id, {
        summary,
      });
      if (
        activity.data.type === "chapter" && // to appease the type checker
        chapter.assignedTo &&
        chapter.due &&
        chapter.assignedTo !== session.userId
      ) {
        activity.data.skip = true;
        // Add stormies to the person who was supposed to do the chapter.
        const daysLate = BigInt(
          Math.floor(
            (Date.now() - Date.parse(chapter.due)) / (24 * 60 * 60 * 1000)
          )
        );
        await db.insert("activities", {
          userId: chapter.assignedTo,
          day,
          stormies: 2n * daysLate,
          data: { type: "skipped", daysLate },
        });
      }
      const chapterIndex = book.chapterIds.indexOf(chapter._id);
      if (chapterIndex === -1) {
        throw new Error(`Chapter not found in book.`);
      }
      if (chapterIndex === book.chapterIds.length - 1) {
        await db.patch(book._id, {
          status: "complete",
          ended: day,
        });
      } else {
        let nextChapterIndex = chapterIndex + 1;
        let nextChapter = (await db.get(book.chapterIds[nextChapterIndex]))!;
        while (nextChapter.summary) {
          // Find the next chapter that hasn't been done yet.
          nextChapterIndex += 1;
          if (nextChapterIndex === book.chapterIds.length) {
            break;
          }
          nextChapter = (await db.get(book.chapterIds[nextChapterIndex]))!;
        }
        if (nextChapterIndex === book.chapterIds.length) {
          // The rest of the book had been done already.
          await db.patch(book._id, {
            status: "complete",
            ended: day,
          });
        } else {
          const nextUserIndex =
            userIndex === book.rotation.length - 1 ? 0 : userIndex + 1;
          const nextUser = (await db.get(book.rotation[nextUserIndex]))!;
          const nextUserTimezone = nextUser.timezone;
          const daysPerChapter = Number(book.daysPerChapter ?? 2n);
          const nextDueDate = getDay(
            Date.now() + daysPerChapter * DayMs,
            nextUserTimezone
          );
          await db.patch(nextChapter._id, {
            assignedTo: nextUser._id,
            due: nextDueDate,
          });
        }
      }
      const activityId = await db.insert("activities", activity);
      return activityId;
    },
  })
);

export const addGroupBook = mutation(
  withSession({
    args: {
      title: string,
      author: string,
      groupId: id("groups"),
      chapterDescriptions: array(string),
      daysPerChapter: opt(bigint),
    },
    handler: async (
      { db, scheduler, session },
      { chapterDescriptions, groupId, ...rest }
    ) => {
      if (!session.userId) {
        throw new Error(`Not logged in.`);
      }
      const user = (await db.get(session.userId))!;
      // Check that user is in the group.
      const group = (await db.get(groupId))!;
      if (!group.members.includes(session.userId)) {
        throw new Error(`User not in group.`);
      }
      const bookId = await db.insert("books", {
        ...rest,
        started: getToday(user.timezone),
        status: "in-progress",
        rotation: group.members,
        chapterIds: [],
      });
      const chapterIds = await Promise.all(
        chapterDescriptions.map((description, index) =>
          db.insert("chapters", {
            bookId,
            description,
            assignedTo: index ? undefined : group.members[0],
          })
        )
      );
      await db.patch(bookId, { chapterIds });
    },
  })
);

export const abandonBook = mutation(
  withSession({
    args: {
      bookId: v.id("books"),
    },
    handler: async ({ db, scheduler, session }, { bookId }) => {
      if (!session.userId) {
        throw new Error(`Not logged in.`);
      }
      const book = (await db.get(bookId))!;
      if (!book.rotation.includes(session.userId)) {
        throw new Error(`User not in book.`);
      }
      await db.patch(bookId, { status: "abandoned" });
    },
  })
);
