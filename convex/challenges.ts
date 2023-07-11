import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import {
  DatabaseReader,
  DatabaseWriter,
  internalAction,
  mutation,
} from "./_generated/server.js";
import { withSession } from "./lib/withSession.js";
import { Doc, Id } from "./_generated/dataModel.js";
import { getUserByPhone } from "./users.js";

const AttemptLimit = 5;
const BackoffMs = [1000, 10000, 30000, 60000];
const MinuteMs = 60000;
const MaxCodeAgeMs = 15 * MinuteMs;

function createCode() {
  // TODO: use crypto once we support it
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function getChallengeCodes(db: DatabaseReader, userId: Id<"users">) {
  const challengeCodes = await db
    .query("challenges")
    .withIndex("userId", (q) =>
      q.eq("userId", userId).gt("_creationTime", Date.now() - MaxCodeAgeMs)
    )
    .order("desc")
    .take(AttemptLimit);
  return challengeCodes;
}

export async function createChallenge(db: DatabaseWriter, userId: Id<"users">) {
  const challengeCodes = await getChallengeCodes(db, userId);
  let latestUsed = challengeCodes[0]?._creationTime ?? null;
  let numUnused = 0;
  for (const c of challengeCodes) {
    if (c.used) {
      latestUsed = c._creationTime;
      break;
    } else {
      numUnused += 1;
    }
  }
  if (challengeCodes.length === AttemptLimit && latestUsed === null) {
    return { success: false as const, error: `Too many unused codes.` };
  }
  if (numUnused > 0) {
    const nextAttempt = latestUsed + BackoffMs[numUnused - 1];
    if (latestUsed && Date.now() < nextAttempt) {
      return {
        success: false as const,
        error: `You must wait until ${new Date(
          nextAttempt
        ).toISOString()} to try again.`,
      };
    }
  }
  const challengeId = await db.insert("challenges", {
    userId,
    used: false,
    code: createCode(),
  });
  const challenge = (await db.get(challengeId))!;
  return { success: true, challenge } as const;
}

export async function validateChallenge(
  db: DatabaseWriter,
  userId: Id<"users">,
  challenge: string
) {
  const failedLogins = await db
    .query("failedLogins")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .unique();
  let logFailure = async () => {
    await db.insert("failedLogins", { failures: [Date.now()], userId });
  };
  if (failedLogins) {
    const { failures } = failedLogins;
    logFailure = async () => {
      await db.patch(failedLogins._id, { failures: [...failures, Date.now()] });
    };

    if (failures.length >= AttemptLimit) {
      return {
        success: false as const,
        error: `Too many failed login attempts.`,
      };
    }
    if (failures.length > 0) {
      const lastIdx = failures.length - 1;
      const nextAttempt = failures[lastIdx] + BackoffMs[lastIdx];
      if (Date.now() < nextAttempt) {
        return {
          success: false as const,
          error: `You must wait until ${new Date(
            nextAttempt
          ).toISOString()} to try again.`,
        };
      }
    }
  }
  const challengeCodes = await getChallengeCodes(db, userId);
  let success = false;
  for (const challengeCode of challengeCodes) {
    // TODO: use a constant time comparison
    if (challenge === challengeCode.code) {
      if (challengeCode.used) {
        await logFailure();
        return { success: false as const, error: `Code already used.` };
      }
      await db.patch(challengeCode._id, { used: true });
      success = true;
      if (failedLogins) await db.delete(failedLogins._id);
      break;
    }
  }
  if (!success) {
    await logFailure();
    return { success: false as const, error: `Invalid code.` };
  }
  return { success: true } as const;
}
