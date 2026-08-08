export function prettyDay(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function prettyDayLong(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * Day arithmetic on yyyy-MM-dd strings, timezone-free — the client half of
 * convex/lib/days.ts. Used to shape an absence before sending it; the
 * backend still reckons every day that costs anything.
 */
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

/** Days in an inclusive range that actually owe pushups — Sundays are free. */
export function pushupDaysBetween(fromDay: string, toDay: string): number {
  let count = 0;
  for (let day = fromDay; day <= toDay; day = addDays(day, 1)) {
    if (new Date(`${day}T00:00:00Z`).getUTCDay() !== 0) {
      count++;
    }
  }
  return count;
}

export function yearOf(day: string | null): string {
  return day ? day.slice(0, 4) : "";
}

/** "Ian M" → "IM", "Peter" → "P" */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
}

export const statusGlyph = {
  star: "⭐️",
  storm: "⛈️",
  missed: "⛈️⛈️",
} as const;
