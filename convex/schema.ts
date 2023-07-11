import { defineTable, defineSchema } from "convex/server";
import { v } from "convex/values";

const string = v.string();
const number = v.number();
const boolean = v.boolean();
const ts = v.number();
const opt = v.optional;
const l = v.literal;
const id = v.id;
const obj = v.object;
const u = v.union;
const date = v.string(); // yyyy-MM-dd
const bigint = v.int64();
const array = v.array;
const flag = opt(boolean);

export default defineSchema({
  users: defineTable({
    name: string,
    phone: string,
    email: opt(string),
    timezone: opt(string),
    groups: array(id("groups")),
  }).index("phone", ["phone"]),

  failedLogins: defineTable({
    userId: id("users"),
    failures: array(ts),
  }).index("userId", ["userId"]),
  challenges: defineTable({
    userId: id("users"),
    code: string,
    used: boolean,
  }).index("userId", ["userId"]),

  sessions: defineTable({
    userId: opt(id("users")),
    disabled: flag,
  }),
  groups: defineTable({
    name: string,
    members: array(id("users")),
  }),
  invites: defineTable({
    inviterId: id("users"),
    inviteeId: id("users"),
    groupId: id("groups"),
    status: u(l("pending"), l("accepted"), l("rejected")),
  })
    .index("inviteeId", ["inviteeId"])
    .index("groupId", ["groupId"])
    .index("inviterId", ["inviterId"]),

  activities: defineTable({
    userId: id("users"),
    day: string,
    stormies: opt(bigint),
    data: u(
      obj({
        type: l("pushups"),
        optout: flag,
        missed: flag,
      }),
      obj({
        type: l("chapter"),
        skip: flag,
        missed: flag,
        chapterId: id("chapters"),
      }),
      obj({
        type: l("skipped"),
        daysLate: opt(bigint),
      })
    ),
  }).index("day", ["day"]),
  chapters: defineTable({
    bookId: id("books"),
    description: string,
    assignedTo: opt(id("users")),
    due: opt(string),
    summary: opt(string),
  }),
  books: defineTable({
    title: string,
    author: string,
    status: u(l("in-progress"), l("complete"), l("abandoned")),
    rotation: array(id("users")),
    started: date,
    ended: opt(date),
    chapterIds: array(id("chapters")),
    daysPerChapter: opt(bigint),
  }),
});
