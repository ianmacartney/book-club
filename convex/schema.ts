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
    username: v.optional(v.string()), //  deprecated
    name: v.string(),
    // IANA timezone; days are always reckoned in the member's own timezone.
    timezone: v.optional(v.string()),
  }),

  clubs: defineTable({
    name: v.string(),
    createdBy: v.id("users"),
  }),

  memberships: defineTable({
    clubId: v.id("clubs"),
    userId: v.id("users"),
    // Ghosts see everything (feed, library, standings) but owe nothing: no
    // pushups, no place in the reading rotation. Absent = full member.
    role: v.optional(v.union(v.literal("member"), v.literal("ghost"))),
  })
    .index("clubId", ["clubId"])
    .index("userId", ["userId"])
    .index("clubUser", ["clubId", "userId"]),

  // Invite-only: joining requires a single-use code minted by a member.
  invites: defineTable({
    clubId: v.id("clubs"),
    code: v.string(),
    createdBy: v.id("users"),
    // Who the code is meant for; pre-fills their display name on redemption.
    forName: v.optional(v.string()),
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

  // Declared absences: "I'll be out of service Aug 3–10." While away the
  // member owes one storm (1 cloud) per required day instead of the 2 clouds
  // silence costs. Pushups are personal (see the clouds table), so a period
  // isn't club-scoped — it covers every club the member owes pushups in.
  offGridPeriods: defineTable({
    userId: v.id("users"),
    fromDay: v.string(), // inclusive, yyyy-MM-dd in the member's timezone
    toDay: v.string(), // inclusive
    note: v.optional(v.string()), // "backpacking, no signal"
    // Usually the member themselves; an admin can file one on their behalf.
    declaredBy: v.id("users"),
  }).index("userFrom", ["userId", "fromDay"]),

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

  // Per-user push notification preferences (Expo tokens live in the
  // pushNotifications component; this holds the app-level choices).
  notificationPrefs: defineTable({
    userId: v.id("users"),
    // "HH:mm" in the member's own timezone — nudge if they haven't reported
    // pushups by then. Unset = no reminder.
    reminderTime: v.optional(v.string()),
    // Last local day a reminder was sent, so the cron fires at most once/day.
    reminderSentDay: v.optional(v.string()),
    // Opt-in: hear about every ⭐️ other members log.
    notifyOnStars: v.boolean(),
    // On by default: section submissions and book finishes.
    notifyOnSubmissions: v.boolean(),
  }).index("userId", ["userId"]),

  books: defineTable({
    clubId: v.id("clubs"),
    title: v.string(),
    author: v.optional(v.string()),
    // Optional because imported pre-app books may not record who picked it.
    suggestedBy: v.optional(v.id("users")),
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

  // The club talking back: a reply to a section's write-up. Threads only
  // hang off written-up sections, so every one of them is rooted in a
  // chapter summary in the feed.
  replies: defineTable({
    // Denormalized from the section's book so the feed can read a club's
    // replies by day — the same indexed day-window scan the rest of the
    // timeline is built from.
    clubId: v.id("clubs"),
    sectionId: v.id("sections"),
    userId: v.id("users"),
    body: v.string(),
    day: v.string(), // yyyy-MM-dd in the author's timezone
  }).index("clubDay", ["clubId", "day"]),

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

  // Free-form feedback from members about the app itself.
  feedback: defineTable({
    userId: v.id("users"),
    message: v.string(),
    // The club the member was in when they wrote it — context, not required.
    clubId: v.optional(v.id("clubs")),
  }).index("userId", ["userId"]),

  /**
   * The club's deck of quotes, split out of section submissions. One row per
   * individual line, so a dud can be hidden without losing the good quote
   * that shared a submission with it.
   *
   * `sort` is a random float in [0, 1) — the row's position in a fixed random
   * permutation of the deck. Each day steps to the next `sort` above the day
   * before, wrapping at the end, which deals the deck in shuffled order:
   * nothing repeats until every quote has had its turn, and a newly submitted
   * quote drops into a random spot in the remaining cycle.
   */
  quotes: defineTable({
    clubId: v.id("clubs"),
    text: v.string(),
    sort: v.number(),
    // Hidden quotes stay out of the deck; the index keys on it so skipping
    // them costs nothing at read time.
    hidden: v.boolean(),
    // Provenance — where the line was pulled from.
    sectionId: v.optional(v.id("sections")),
    bookId: v.optional(v.id("books")),
    submittedBy: v.optional(v.id("users")),
    submittedDay: v.optional(v.string()),
  })
    .index("clubDeck", ["clubId", "hidden", "sort"])
    // Keeps re-indexing a submission idempotent.
    .index("section", ["sectionId"]),

  // The quote each club day landed on. One row per club per day, minted by
  // the hourly cron, which is also what freezes the pick for the whole day.
  dailyQuotes: defineTable({
    clubId: v.id("clubs"),
    day: v.string(),
    quoteId: v.id("quotes"),
    // Frozen at mint: hiding or rewording a quote can't change what the club
    // was actually shown that day.
    text: v.string(),
    // The deck cursor this day landed on — tomorrow steps from here. Held
    // here rather than looked up through `quoteId` so that hiding a quote
    // can't strand the cursor.
    sort: v.number(),
  }).index("clubDay", ["clubId", "day"]),

  // 👍/👎 on a quote. Unlike a check-in these are freely changeable.
  quoteReactions: defineTable({
    userId: v.id("users"),
    quoteId: v.id("quotes"),
    reaction: v.union(v.literal("up"), v.literal("down")),
  })
    .index("quoteUser", ["quoteId", "userId"])
    // For "the quotes I liked" — not surfaced yet.
    .index("userReaction", ["userId", "reaction"]),

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
