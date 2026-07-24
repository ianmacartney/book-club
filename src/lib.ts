import { ConvexError } from "convex/values";

export function errorMessage(err: unknown): string {
  if (err instanceof ConvexError && typeof err.data === "string") {
    return err.data;
  }
  return err instanceof Error ? err.message : String(err);
}

export function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function timezoneOptions(): string[] {
  return Intl.supportedValuesOf("timeZone");
}

export function prettyDay(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
