/**
 * All deadlines in the club are "calendar days in your own timezone".
 * Days are represented as yyyy-MM-dd strings; arithmetic on them is
 * timezone-free, and only "what day is it right now for this member"
 * consults an IANA timezone.
 */

export const DEFAULT_TIMEZONE = "America/Los_Angeles";

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

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
