import { v } from "convex/values";
import { api, internal } from "../convex/_generated/api.js";
import {
  DatabaseReader,
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { withSession } from "./lib/withSession.js";
import { createChallenge, validateChallenge } from "./challenges.js";
import { Doc } from "./_generated/dataModel.js";

const MaxOutstandingInvites = 20;

export const makeSession = mutation({
  args: {},
  handler: async ({ db, scheduler }, {}) => {
    return await db.insert("sessions", {});
  },
});

export async function getUserByPhone(db: DatabaseReader, phone: string) {
  const user = await db
    .query("users")
    .withIndex("phone", (q) => q.eq("phone", phone))
    .unique();
  return user;
}

export const editName = mutation(
  withSession({
    args: {
      name: v.string(),
    },
    handler: async ({ db, scheduler, session }, { name }) => {
      if (!session.userId) {
        throw new Error(`Not logged in.`);
      }
      await db.patch(session.userId, { name });
    },
  })
);

export const invite = mutation(
  withSession({
    args: {
      name: v.string(),
      phone: v.string(),
      groupId: v.id("groups"),
    },
    handler: async (ctx, { name, phone, groupId }) => {
      const { db, session } = ctx;
      if (!session.userId) {
        throw new Error(`Not logged in.`);
      }
      const inviterId = session.userId;
      const group = (await db.get(groupId))!;
      if (!group.members.includes(session.userId)) {
        throw new Error(`Inviter is not in the group.`);
      }
      const user = await getUserByPhone(db, phone);
      if (user) {
        if (user._id === session.userId) {
          return { success: false, error: `Can't invite yourself.` };
        }
        if (user.groups.includes(groupId)) {
          return { success: false, error: `User already in group.` };
        }
      }
      const userId = user
        ? user._id
        : await db.insert("users", {
            name,
            phone,
            groups: [],
          });
      const invites = await db
        .query("invites")
        .withIndex("inviteeId", (q) => q.eq("inviteeId", userId))
        .collect();
      if (invites.find((i) => i.groupId === groupId)) {
        return { success: false, error: `User already invited to group.` };
      }
      const sentInvites = await db
        .query("invites")
        .withIndex("inviterId", (q) => q.eq("inviterId", inviterId))
        .filter((q) => q.neq(q.field("status"), "accepted"))
        .collect();
      if (sentInvites.length >= MaxOutstandingInvites) {
        return { success: false, error: `Too many outstanding invites.` };
      }
      await db.insert("invites", {
        inviterId: session.userId,
        inviteeId: userId,
        groupId,
        status: "pending",
      });
      return await logIn(ctx, { phone });
    },
  })
);

export const respondToInvite = mutation(
  withSession({
    args: {
      inviteId: v.id("invites"),
      status: v.union(v.literal("accepted"), v.literal("rejected")),
    },
    handler: async ({ db, scheduler, session }, { inviteId, status }) => {
      if (!session.userId) {
        throw new Error(`Not logged in.`);
      }
      const invite = (await db.get(inviteId))!;
      if (session.userId !== invite.inviteeId) {
        throw new Error(`Not your invite.`);
      }
      await db.patch(inviteId, { status });
      if (status == "accepted") {
        const group = (await db.get(invite.groupId))!;
        await db.patch(invite.groupId, {
          members: [...group.members, invite.inviteeId],
        });
      }
    },
  })
);

export const logIn = mutation({
  args: {
    phone: v.string(),
  },
  handler: async ({ db, scheduler }, { phone }) => {
    const user = await getUserByPhone(db, phone);
    if (!user) {
      return { success: false, error: `User not found.` };
    }
    const result = await createChallenge(db, user._id);
    if (result.success) {
      await scheduler.runAfter(0, internal.users.sendChallengeSMS, {
        userId: user._id,
        code: result.challenge.code,
      });
      return { success: true } as const;
    }
    return result;
  },
});

export const logOut = mutation(
  withSession({
    args: {},
    handler: async ({ db, scheduler, session }, {}) => {
      await db.patch(session._id, { userId: undefined });
    },
  })
);

export const sendChallengeSMS = internalAction({
  args: {
    userId: v.id("users"),
    code: v.string(),
  },
  handler: async ({ runMutation, scheduler }, { userId, code }) => {
    // TODO send SMS
    console.log("sending...", { userId, code });
  },
});

export const attemptChallenge = mutation(
  withSession({
    args: {
      phone: v.string(),
      challenge: v.string(),
    },
    handler: async ({ db, scheduler, session }, { phone, challenge }) => {
      // TODO: check challenge
      const user = await getUserByPhone(db, phone);
      if (!user) {
        return { success: false, error: `User not found.` };
      }
      const result = await validateChallenge(db, user._id, challenge);
      if (!result.success) {
        return result;
      }
      await db.patch(session._id, { userId: user._id });
      return { success: true } as const;
    },
  })
);
