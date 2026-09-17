import { PushNotifications } from "@convex-dev/expo-push-notifications";
import { ConvexError, v, type Infer } from "convex/values";
import { components, internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import {
  MutationCtx,
  QueryCtx,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { requireUser } from "./lib/access";
import { isPushupDay, timeNowInTz, todayInTz } from "./lib/days";
import { offGridOn } from "./lib/offgrid";
import { activeMemberships, hasReadingMembership } from "./lib/reading";

/**
 * Push notifications for the mobile app, via the Expo push notifications
 * component. Expo push tokens live inside the component; this module owns
 * the app-level preferences (convex/schema.ts `notificationPrefs`) and the
 * four kinds of sends:
 *
 *  1. section submissions — everyone hears a chapter landed; the next
 *     reader gets a "you're up" regardless of preferences;
 *  2. replies to a write-up, on the same switch as the write-ups themselves;
 *  3. a daily push-up / nomination reminder at a member-chosen local time;
 *  4. opt-in ⭐️ announcements when a member logs their pushups.
 */
export const push = new PushNotifications(components.pushNotifications);

const DEFAULT_PREFS = {
  reminderTime: undefined as string | undefined,
  notifyOnStars: false,
  notifyOnSubmissions: true,
};

async function prefsFor(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Doc<"notificationPrefs"> | null> {
  return await ctx.db
    .query("notificationPrefs")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .unique();
}

function displayName(user: Doc<"users"> | null): string {
  return user?.name ?? "someone";
}

// ---------------------------------------------------------------------------
// Client-facing API (token registration + settings)
// ---------------------------------------------------------------------------

/** Called by the mobile app after getting an Expo push token. */
export const registerPushToken = mutation({
  args: { token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await push.recordToken(ctx, {
      userId: user._id,
      pushToken: args.token,
    });
    return null;
  },
});

/** Called on sign-out (or from settings) to stop all pushes to this device. */
export const removePushToken = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    await push.removeToken(ctx, { userId: user._id });
    return null;
  },
});

export const mySettings = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const prefs = await prefsFor(ctx, user._id);
    const status = await push.getStatusForUser(ctx, { userId: user._id });
    return {
      hasToken: status.hasToken,
      paused: status.paused,
      reminderTime: prefs?.reminderTime ?? DEFAULT_PREFS.reminderTime ?? null,
      notifyOnStars: prefs?.notifyOnStars ?? DEFAULT_PREFS.notifyOnStars,
      notifyOnSubmissions:
        prefs?.notifyOnSubmissions ?? DEFAULT_PREFS.notifyOnSubmissions,
    };
  },
});

export const updateSettings = mutation({
  args: {
    // "HH:mm" in the member's timezone; null clears the reminder.
    reminderTime: v.optional(v.union(v.string(), v.null())),
    notifyOnStars: v.optional(v.boolean()),
    notifyOnSubmissions: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (
      args.reminderTime !== undefined &&
      args.reminderTime !== null &&
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(args.reminderTime)
    ) {
      throw new ConvexError("Reminder time must look like 21:30 (24h).");
    }
    const existing = await prefsFor(ctx, user._id);
    const next = {
      reminderTime:
        args.reminderTime === undefined
          ? existing?.reminderTime
          : (args.reminderTime ?? undefined),
      notifyOnStars:
        args.notifyOnStars ??
        existing?.notifyOnStars ??
        DEFAULT_PREFS.notifyOnStars,
      notifyOnSubmissions:
        args.notifyOnSubmissions ??
        existing?.notifyOnSubmissions ??
        DEFAULT_PREFS.notifyOnSubmissions,
    };
    if (existing === null) {
      await ctx.db.insert("notificationPrefs", {
        userId: user._id,
        ...next,
      });
    } else {
      await ctx.db.replace("notificationPrefs", existing._id, {
        userId: user._id,
        reminderSentDay: existing.reminderSentDay,
        nominationReminderSentDay: existing.nominationReminderSentDay,
        ...next,
      });
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// Send helpers (called from other mutations — never throw at callers)
// ---------------------------------------------------------------------------

const sendValidator = v.object({
  userId: v.id("users"),
  notification: v.object({
    title: v.string(),
    body: v.optional(v.string()),
    sound: v.optional(v.string()),
    data: v.optional(v.any()),
  }),
});
type Send = Infer<typeof sendValidator>;

async function sendBatch(ctx: MutationCtx, sends: Send[]): Promise<void> {
  if (sends.length === 0) {
    return;
  }
  // Commit the submission before touching the push component. Delivery runs
  // in its own transaction, so a notification failure cannot roll it back.
  try {
    await ctx.scheduler.runAfter(0, internal.notifications.deliverBatch, {
      sends,
    });
  } catch (err) {
    console.error("could not schedule push notification batch", err);
  }
}

export const deliverBatch = internalMutation({
  args: { sends: v.array(sendValidator) },
  returns: v.null(),
  handler: async (ctx, { sends }) => {
    const registered: Send[] = [];
    for (let send of sends) {
      // The book may have finished or the member may have nominated between
      // scheduling and delivery. Never send a reminder that is already stale.
      if (send.notification.data?.type === "daily_reminder") {
        const user = await ctx.db.get("users", send.userId);
        if (!user) continue;
        const prefs = await prefsFor(ctx, user._id);
        if (
          !prefs?.reminderTime ||
          timeNowInTz(user.timezone) < prefs.reminderTime
        )
          continue;
        const current = await dailyReminder(
          ctx,
          user,
          send.notification.data.day,
          send.notification.data.pushups,
          send.notification.data.nominations,
        );
        if (!current) continue;
        send = current;
      } else if (
        send.notification.data?.type === "reminder" &&
        !(await hasReadingMembership(ctx, send.userId))
      ) {
        continue; // Reminders queued by the previous version, before the break.
      }
      const status = await push.getStatusForUser(ctx, { userId: send.userId });
      if (status.hasToken && !status.paused) {
        registered.push(send);
      }
    }
    // Missing tokens are normal for web users and members who declined push.
    // The component logs them as ERROR even with allowUnregisteredTokens set.
    if (registered.length > 0) {
      await push.sendPushNotificationBatch(ctx, {
        notifications: registered,
        allowUnregisteredTokens: true,
      });
    }
    return null;
  },
});

/**
 * Expo caps a push message at 4 KiB total, so give the summary most of the
 * room and leave headroom for the title, data payload, and JSON overhead.
 */
const MAX_BODY_CHARS = 2000;

function asBody(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.length <= MAX_BODY_CHARS
    ? trimmed
    : `${trimmed.slice(0, MAX_BODY_CHARS - 1)}…`;
}

/**
 * A section landed: tell the club, and tell the next reader it's their turn.
 * The "you're up" is deadline-critical, so it ignores notifyOnSubmissions.
 */
export async function notifySectionSubmitted(
  ctx: MutationCtx,
  args: {
    book: Doc<"books">;
    sectionTitle: string;
    by: Doc<"users">;
    assigneeName: string;
    skip: boolean;
    // The write-up was banked in advance and released the moment its turn
    // came round, rather than typed just now.
    early?: boolean;
    thoughts: string;
    memberIds: Id<"users">[];
    next: { assigneeId: Id<"users">; title: string; dueDay: string } | null;
  },
): Promise<void> {
  const byName = displayName(args.by);
  // Brief header, then as much of the write-up as a push allows.
  const title = args.skip
    ? `${byName} covered “${args.sectionTitle}” for ${args.assigneeName}`
    : args.early
      ? `${byName} had “${args.sectionTitle}” ready and waiting`
      : `${byName} finished “${args.sectionTitle}”`;
  const body = asBody(args.thoughts);
  const sends: Send[] = [];
  if (args.early) {
    // Everyone else is being told; the writer wasn't in the room when their
    // own draft went out, so they hear it too.
    sends.push({
      userId: args.by._id,
      notification: {
        title: `Your write-up for “${args.sectionTitle}” just posted`,
        body: "You came up in the rotation, so the draft you left went out.",
        data: { type: "submission", bookId: args.book._id },
      },
    });
  }
  for (const memberId of args.memberIds) {
    if (memberId === args.by._id) {
      continue;
    }
    if (args.next !== null && memberId === args.next.assigneeId) {
      sends.push({
        userId: memberId,
        notification: {
          title: `You're up: “${args.next.title}” — due ${args.next.dueDay}`,
          body,
          sound: "default",
          data: { type: "your_turn", bookId: args.book._id },
        },
      });
      continue;
    }
    const prefs = await prefsFor(ctx, memberId);
    if (prefs?.notifyOnSubmissions ?? DEFAULT_PREFS.notifyOnSubmissions) {
      sends.push({
        userId: memberId,
        notification: {
          title,
          body,
          data: { type: "submission", bookId: args.book._id },
        },
      });
    }
  }
  await sendBatch(ctx, sends);
}

/**
 * Someone replied to a section write-up. Whoever wrote the section up always
 * hears it — the reply is addressed to them, the way "you're up" is — and
 * everyone else rides `notifyOnSubmissions`, the switch for book talk.
 */
export async function notifyReply(
  ctx: MutationCtx,
  args: {
    by: Doc<"users">;
    body: string;
    bookId: Id<"books">;
    sectionTitle: string;
    writerId: Id<"users">;
    memberIds: Id<"users">[];
  },
): Promise<void> {
  const title = `${displayName(args.by)} on “${args.sectionTitle}”`;
  const body = asBody(args.body);
  const sends: Send[] = [];
  for (const memberId of args.memberIds) {
    if (memberId === args.by._id) {
      continue;
    }
    if (memberId !== args.writerId) {
      const prefs = await prefsFor(ctx, memberId);
      if (!(prefs?.notifyOnSubmissions ?? DEFAULT_PREFS.notifyOnSubmissions)) {
        continue;
      }
    }
    sends.push({
      userId: memberId,
      notification: {
        title,
        body,
        data: { type: "reply", bookId: args.bookId },
      },
    });
  }
  await sendBatch(ctx, sends);
}

/** The last section landed and the book is done: everyone hears the verdict. */
export async function notifyBookFinished(
  ctx: MutationCtx,
  args: {
    book: Doc<"books">;
    memberIds: Id<"users">[];
    byId: Id<"users">;
    loserNames: string[];
  },
): Promise<void> {
  const stakes =
    args.loserNames.length > 0
      ? `${args.loserNames.join(" & ")} owes: ${args.book.punishment} ☠️`
      : "A spotless book — nobody owes the punishment 🎉";
  const sends: Send[] = args.memberIds
    .filter((id) => id !== args.byId)
    .map((userId) => ({
      userId,
      notification: {
        title: `📕 ${args.book.title} is finished!`,
        body: stakes,
        sound: "default",
        data: { type: "book_finished", bookId: args.book._id },
      },
    }));
  await sendBatch(ctx, sends);
}

/** A member logged a ⭐️ — announce it to clubmates who opted in. */
export async function notifyStarLogged(
  ctx: MutationCtx,
  user: Doc<"users">,
): Promise<void> {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- a user's club memberships — a small bounded set
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("userId", (q) => q.eq("userId", user._id))
    .collect();
  const clubmateIds = new Set<Id<"users">>();
  for (const membership of memberships) {
    if (membership.role === "ghost") continue;
    const activeBook = await ctx.db
      .query("books")
      .withIndex("clubStatus", (q) =>
        q.eq("clubId", membership.clubId).eq("status", "active"),
      )
      .first();
    if (!activeBook) continue;
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- a club's members — bounded (~100)
    const others = await ctx.db
      .query("memberships")
      .withIndex("clubId", (q) => q.eq("clubId", membership.clubId))
      .collect();
    others.forEach((m) => clubmateIds.add(m.userId));
  }
  clubmateIds.delete(user._id);

  const sends: Send[] = [];
  for (const memberId of clubmateIds) {
    const prefs = await prefsFor(ctx, memberId);
    if (prefs?.notifyOnStars ?? DEFAULT_PREFS.notifyOnStars) {
      sends.push({
        userId: memberId,
        notification: {
          title: `${displayName(user)}: ⭐️`,
          data: { type: "star" },
        },
      });
    }
  }
  await sendBatch(ctx, sends);
}

// ---------------------------------------------------------------------------
// Daily reminder cron (see convex/crons.ts — runs every 15 minutes)
// ---------------------------------------------------------------------------

async function dailyReminder(
  ctx: MutationCtx,
  user: Doc<"users">,
  day: string,
  includePushups: boolean,
  includeNominations: boolean,
): Promise<Send | null> {
  if (day !== todayInTz(user.timezone) || (await offGridOn(ctx, user._id, day)))
    return null;
  let pushups = false;
  if (
    includePushups &&
    isPushupDay(day) &&
    (await hasReadingMembership(ctx, user._id))
  ) {
    const checkin = await ctx.db
      .query("checkins")
      .withIndex("userDay", (q) => q.eq("userId", user._id).eq("day", day))
      .unique();
    pushups = checkin === null;
  }
  const polls: { pollId: Id<"polls">; clubId: Id<"clubs">; name: string }[] =
    [];
  if (includeNominations) {
    for (const membership of await activeMemberships(ctx, user._id)) {
      const poll = await ctx.db
        .query("polls")
        .withIndex("clubStatus", (q) =>
          q.eq("clubId", membership.clubId).eq("status", "nominating"),
        )
        .first();
      if (!poll) continue;
      const nomination = await ctx.db
        .query("nominations")
        .withIndex("pollUser", (q) =>
          q.eq("pollId", poll._id).eq("suggestedBy", user._id),
        )
        .first();
      if (nomination) continue; // One suggestion satisfies the reminder; two is a limit, not a quota.
      const club = await ctx.db.get("clubs", membership.clubId);
      polls.push({
        pollId: poll._id,
        clubId: membership.clubId,
        name: club?.name ?? "Your club",
      });
    }
  }
  const nominations = polls.length > 0;
  if (!pushups && !nominations) return null;
  return {
    userId: user._id,
    notification: {
      title: nominations
        ? pushups
          ? "Push-ups and your next book"
          : "Nominate the next book"
        : "We haven't heard from you yet today",
      body: nominations
        ? `${pushups ? "Report your push-ups. " : ""}Nominations are open in ${polls.map((p) => p.name).join(", ")}. Suggest a book in the Library.`
        : "Report today's push-ups before your midnight.",
      sound: "default",
      data: {
        type: "daily_reminder",
        day,
        pushups,
        nominations,
        pollIds: polls.map((p) => p.pollId),
        clubIds: polls.map((p) => p.clubId),
      },
    },
  };
}

/**
 * At the member's chosen local time, remind them of required push-ups and/or
 * an outstanding nomination. Each reason sends at most once per local day;
 * simultaneous reminders share one push. Nominations also run on rest days.
 */
export const sendReminders = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- one row per user — bounded (a few dozen)
    const allPrefs = await ctx.db.query("notificationPrefs").collect();
    const sends: Send[] = [];
    for (const prefs of allPrefs) {
      if (prefs.reminderTime === undefined) {
        continue;
      }
      const user = await ctx.db.get("users", prefs.userId);
      if (user === null) {
        continue;
      }
      const today = todayInTz(user.timezone);
      if (timeNowInTz(user.timezone) < prefs.reminderTime) {
        continue;
      }
      const send = await dailyReminder(
        ctx,
        user,
        today,
        prefs.reminderSentDay !== today,
        prefs.nominationReminderSentDay !== today,
      );
      if (!send) continue;
      sends.push(send);
      await ctx.db.patch("notificationPrefs", prefs._id, {
        ...(send.notification.data.pushups ? { reminderSentDay: today } : {}),
        ...(send.notification.data.nominations
          ? { nominationReminderSentDay: today }
          : {}),
      });
    }
    await sendBatch(ctx, sends);
    return null;
  },
});
