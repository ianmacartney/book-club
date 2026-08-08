import { ConvexError, v } from "convex/values";

/**
 * All deadlines in the club are "calendar days in your own timezone".
 * Days are represented as yyyy-MM-dd strings; arithmetic on them is
 * timezone-free, and only "what day is it right now for this member"
 * consults an IANA timezone.
 */

export const DEFAULT_TIMEZONE = "America/Los_Angeles";

/**
 * A query that asks the clock what day it is isn't reactive to the clock.
 * Convex recomputes a query when its *read set* changes, and midnight writes
 * nothing — so a session opened at 23:59 keeps serving yesterday. Check in
 * after midnight and the new row lands on a day the cached query never read:
 * nothing invalidates, and the screen sits there looking broken.
 *
 * Readers therefore pass their own local day, and it is **authoritative** for
 * their day (see `readerDay`). Deriving it from the clock instead and using
 * the argument only to re-key the subscription would leave a worse hole: a
 * client whose clock is a second ahead of the backend's re-keys to tomorrow
 * while the handler still computes today, and the result caches under a day
 * it isn't for. Nothing would ever recompute it — the client keeps sending
 * that same key — so the staleness would last the whole day instead of a
 * moment. Taking the argument as given makes the result a pure function of
 * the arguments again, which is the property Convex's cache assumes.
 *
 * A wrong device clock can only mislead the reader's own display: every
 * mutation still reckons days server-side from the member's stored timezone,
 * so nothing here can move a deadline or a cloud.
 */
export const viewerDay = v.optional(v.string());

/**
 * The reader's own calendar day: the day they told us, or the clock when
 * they didn't (the CLI, crons, and any client predating the argument).
 */
export function readerDay(
  claimed: string | undefined,
  timezone: string | undefined,
): string {
  if (claimed === undefined) {
    return todayInTz(timezone);
  }
  if (!isValidDay(claimed)) {
    throw new ConvexError(`Not a calendar day: ${claimed}`);
  }
  return claimed;
}

export function dayInTz(ts: number, timezone: string | undefined): string {
  // en-CA formats as yyyy-MM-dd.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone ?? DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ts));
}

export function todayInTz(timezone: string | undefined): string {
  return dayInTz(Date.now(), timezone);
}

/** Current wall-clock time as "HH:mm" (24h) in the given timezone. */
export function timeNowInTz(timezone: string | undefined): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone ?? DEFAULT_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** How many days `a` is after `b` (negative if before). */
export function diffDays(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000,
  );
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOfDay(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** Pushups are required Monday through Saturday. */
export function isPushupDay(day: string): boolean {
  return weekdayOfDay(day) !== 0;
}

/** A real calendar day, written yyyy-MM-dd (so "2026-02-31" is not one). */
export function isValidDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && addDays(day, 0) === day;
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
