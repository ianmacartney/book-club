import { PushNotifications } from "@convex-dev/expo-push-notifications";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import {
  MutationCtx,
  QueryCtx,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { hasActiveMembership, requireUser } from "./lib/access";
import { isPushupDay, timeNowInTz, todayInTz } from "./lib/days";

/**
 * Push notifications for the mobile app, via the Expo push notifications
 * component. Expo push tokens live inside the component; this module owns
 * the app-level preferences (convex/schema.ts `notificationPrefs`) and the
 * three kinds of sends:
 *
 *  1. section submissions — everyone hears a chapter landed; the next
 *     reader gets a "you're up" regardless of preferences;
 *  2. a daily pushup reminder at a member-chosen local time (cron below);
 *  3. opt-in ⭐️ announcements when a member logs their pushups.
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
  return user?.name ?? user?.username ?? "someone";
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
        ...next,
      });
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// Send helpers (called from other mutations — never throw at callers)
// ---------------------------------------------------------------------------

type Send = {
  userId: Id<"users">;
  notification: { title: string; body?: string; sound?: string; data?: any };
};

async function sendBatch(ctx: MutationCtx, sends: Send[]): Promise<void> {
  if (sends.length === 0) {
    return;
  }
  // Sending must never break the mutation it rides along with (check-ins and
  // section submissions are the club's real bookkeeping).
  try {
    await push.sendPushNotificationBatch(ctx, {
      notifications: sends,
      allowUnregisteredTokens: true,
    });
  } catch (err) {
    console.error("push notification batch failed", err);
  }
}

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
    thoughts: string;
    memberIds: Id<"users">[];
    next: { assigneeId: Id<"users">; title: string; dueDay: string } | null;
  },
): Promise<void> {
  const byName = displayName(args.by);
  // Brief header, then as much of the write-up as a push allows.
  const title = args.skip
    ? `${byName} covered “${args.sectionTitle}” for ${args.assigneeName}`
    : `${byName} finished “${args.sectionTitle}”`;
  const body = asBody(args.thoughts);
  const sends: Send[] = [];
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
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("userId", (q) => q.eq("userId", user._id))
    .collect();
  const clubmateIds = new Set<Id<"users">>();
  for (const membership of memberships) {
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

/**
 * Nudge anyone past their chosen reminder time who hasn't reported pushups
 * yet today (in their own timezone). At most one nudge per local day.
 */
export const sendReminders = internalMutation({
  args: {},
  handler: async (ctx) => {
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
      // Ghosts owe no pushups, so they get no reminders.
      if (!(await hasActiveMembership(ctx, user._id))) {
        continue;
      }
      const today = todayInTz(user.timezone);
      if (
        !isPushupDay(today) ||
        prefs.reminderSentDay === today ||
        timeNowInTz(user.timezone) < prefs.reminderTime
      ) {
        continue;
      }
      const checkin = await ctx.db
        .query("checkins")
        .withIndex("userDay", (q) =>
          q.eq("userId", user._id).eq("day", today),
        )
        .unique();
      if (checkin !== null) {
        continue;
      }
      sends.push({
        userId: user._id,
        notification: {
          title: "We haven't heard from you yet today",
          sound: "default",
          data: { type: "reminder" },
        },
      });
      await ctx.db.patch("notificationPrefs", prefs._id, { reminderSentDay: today });
    }
    await sendBatch(ctx, sends);
  },
});
