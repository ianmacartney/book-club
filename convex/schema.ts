import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const cloudSource = v.union(
  v.literal("pushups_storm"), // user reported ⛈️ themselves (1 cloud)
  v.literal("pushups_missed"), // no report for a required day (2 clouds)
  v.literal("section_late"), // accrued per day a section is overdue (2/day)
  v.literal("section_skip"), // someone else submitted your section (2 clouds)
);

export const checkinStatus = v.union(
  v.literal("star"), // ⭐️ did the pushups
  v.literal("storm"), // ⛈️ did not
  v.literal("missed"), // said nothing all day
);

export const submissionValidator = v.object({
  by: v.id("users"),
  day: v.string(), // submitter's local yyyy-MM-dd
  at: v.number(),
  quotes: v.string(),
  thoughts: v.string(),
  skip: v.boolean(), // true when submitted on behalf of an overdue member
});

export const tallyValidator = v.object({
  userId: v.id("users"),
  clouds: v.number(),
});

export default defineSchema({
  // Convex Auth creates a row per account via users.createOrUpdateUser.
  users: defineTable({
    username: v.string(),
    name: v.optional(v.string()),
    // IANA timezone; days are always reckoned in the member's own timezone.
    timezone: v.optional(v.string()),
  }).index("username", ["username"]),

  clubs: defineTable({
    name: v.string(),
    createdBy: v.id("users"),
  }),

  memberships: defineTable({
    clubId: v.id("clubs"),
    userId: v.id("users"),
  })
    .index("clubId", ["clubId"])
    .index("userId", ["userId"])
    .index("clubUser", ["clubId", "userId"]),

  // Invite-only: joining requires a single-use code minted by a member.
  invites: defineTable({
    clubId: v.id("clubs"),
    code: v.string(),
    createdBy: v.id("users"),
    usedBy: v.optional(v.id("users")),
  })
    .index("code", ["code"])
    .index("clubId", ["clubId"]),

  // One row per member per required day (Mon–Sat in their timezone).
  checkins: defineTable({
    userId: v.id("users"),
    day: v.string(), // yyyy-MM-dd in the member's timezone
    status: checkinStatus,
  }).index("userDay", ["userId", "day"]),

  // Ledger of stormy clouds. Tallies are sums over a day range.
  clouds: defineTable({
    userId: v.id("users"),
    day: v.string(), // the day the clouds are for, in the member's timezone
    count: v.number(),
    source: cloudSource,
    clubId: v.optional(v.id("clubs")),
    bookId: v.optional(v.id("books")),
    sectionId: v.optional(v.id("sections")),
  })
    .index("userDay", ["userId", "day"])
    // For idempotent late-day accrual by the cron.
    .index("sectionDay", ["sectionId", "day"]),

  books: defineTable({
    clubId: v.id("clubs"),
    title: v.string(),
    author: v.optional(v.string()),
    suggestedBy: v.id("users"),
    // The punishment the loser owes, set by whoever suggested the book.
    punishment: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("finished"),
      v.literal("abandoned"),
    ),
    rotation: v.array(v.id("users")), // reading order, fixed at start
    startedDay: v.string(),
    endedDay: v.optional(v.string()),
    // Snapshot computed when the final section lands.
    result: v.optional(
      v.object({
        tallies: v.array(tallyValidator),
        loserIds: v.array(v.id("users")), // > 1 on a tie
      }),
    ),
    pollId: v.optional(v.id("polls")),
  })
    .index("clubStatus", ["clubId", "status"])
    // For the cron sweeping every active book across all clubs.
    .index("status", ["status"]),

  sections: defineTable({
    bookId: v.id("books"),
    index: v.number(),
    title: v.string(), // e.g. "Chapters 1–3" or "pp. 1–40"
    assignedTo: v.id("users"),
    dueDay: v.optional(v.string()), // set when the previous section lands
    submission: v.optional(submissionValidator),
  }).index("bookIdx", ["bookId", "index"]),

  polls: defineTable({
    clubId: v.id("clubs"),
    createdBy: v.id("users"),
    status: v.union(
      v.literal("nominating"),
      v.literal("voting"),
      v.literal("runoff"),
      v.literal("done"),
    ),
    runoffNominationIds: v.optional(v.array(v.id("nominations"))),
    winnerNominationId: v.optional(v.id("nominations")),
  }).index("clubId", ["clubId"]),

  nominations: defineTable({
    pollId: v.id("polls"),
    title: v.string(),
    author: v.optional(v.string()),
    punishment: v.string(),
    suggestedBy: v.id("users"),
  }).index("pollId", ["pollId"]),

  votes: defineTable({
    pollId: v.id("polls"),
    round: v.union(v.literal("initial"), v.literal("runoff")),
    userId: v.id("users"),
    nominationIds: v.array(v.id("nominations")),
  })
    .index("pollRound", ["pollId", "round"])
    .index("pollRoundUser", ["pollId", "round", "userId"]),

  // Sunday snapshots, compiled by cron.
  summaries: defineTable({
    clubId: v.id("clubs"),
    weekEndingDay: v.string(), // the Sunday (UTC) the summary was compiled
    bookId: v.optional(v.id("books")),
    entries: v.array(
      v.object({
        userId: v.id("users"),
        weekClouds: v.number(),
        bookClouds: v.number(),
      }),
    ),
  }).index("clubWeek", ["clubId", "weekEndingDay"]),
});
