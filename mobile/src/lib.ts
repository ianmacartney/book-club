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
