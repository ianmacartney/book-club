import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { dayInTz, isPushupDay } from "./days";

type ReadCtx = QueryCtx | MutationCtx;

export function bookStartDay(book: Doc<"books">, timezone?: string): string {
  return book.startedAt === undefined
    ? book.startedDay
    : dayInTz(book.startedAt, timezone);
}

export function bookEndDay(
  book: Doc<"books">,
  timezone?: string,
): string | undefined {
  return book.endedAt === undefined
    ? book.endedDay
    : dayInTz(book.endedAt, timezone);
}

/** Missing reports are excused on the local finish day. Already submitted
 * reports may still belong to that day, so history can include the endpoint. */
export function readingOnDay(
  book: Doc<"books">,
  day: string,
  timezone?: string,
  includeFinishDay = false,
): boolean {
  if (bookStartDay(book, timezone) > day) return false;
  if (book.status === "active") return true;
  const end = bookEndDay(book, timezone);
  return end !== undefined && (includeFinishDay ? day <= end : day < end);
}

export async function activeMemberships(ctx: ReadCtx, userId: Id<"users">) {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- one user's small set of club memberships
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .collect();
  return memberships.filter((m) => m.role !== "ghost");
}

export async function hasReadingMembership(
  ctx: ReadCtx,
  userId: Id<"users">,
): Promise<boolean> {
  for (const membership of await activeMemberships(ctx, userId)) {
    const book = await ctx.db
      .query("books")
      .withIndex("clubStatus", (q) =>
        q.eq("clubId", membership.clubId).eq("status", "active"),
      )
      .first();
    if (book) return true;
  }
  return false;
}

export async function clubBooks(ctx: ReadCtx, clubId: Id<"clubs">) {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- a club's book history is bounded (<1000); no truncated history when testing an old day
  return await ctx.db
    .query("books")
    .withIndex("clubStarted", (q) => q.eq("clubId", clubId))
    .collect();
}

export type ReadingPeriod = { book: Doc<"books">; joinedDay: string };
export async function readingPeriods(
  ctx: ReadCtx,
  user: Doc<"users">,
): Promise<ReadingPeriod[]> {
  const periods: ReadingPeriod[] = [];
  for (const membership of await activeMemberships(ctx, user._id)) {
    const joinedDay = dayInTz(membership._creationTime, user.timezone);
    for (const book of await clubBooks(ctx, membership.clubId))
      periods.push({ book, joinedDay });
  }
  return periods;
}

export function pushupsRequired(
  periods: ReadingPeriod[],
  day: string,
  timezone?: string,
): boolean {
  return (
    isPushupDay(day) &&
    periods.some(
      ({ book, joinedDay }) =>
        day >= joinedDay && readingOnDay(book, day, timezone),
    )
  );
}

/** A real report submitted during the book remains visible on its finish day.
 * Automatically generated missed/storm rows after it ended do not. */
export function reportBelongsToBook(
  book: Doc<"books">,
  checkin: Doc<"checkins">,
  timezone?: string,
): boolean {
  if (!readingOnDay(book, checkin.day, timezone, checkin.status !== "missed"))
    return false;
  if (book.status !== "active" && checkin.day === bookEndDay(book, timezone)) {
    // Imported reports were inserted later; without a finish timestamp,
    // preserve them rather than guessing whether they preceded the finish.
    return book.endedAt === undefined || checkin._creationTime <= book.endedAt;
  }
  return true;
}
