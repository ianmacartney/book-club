import { ConvexError } from "convex/values";
import { useEffect, useState } from "react";

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

/** The browser's calendar day as yyyy-MM-dd. */
function localDay(): string {
  const d = new Date();
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * The reader's local day, re-rendering when it changes. Queries that reckon
 * "today" pass this so they re-run at midnight instead of serving a result
 * cached yesterday (see `viewerDay` in convex/lib/days.ts) — without it, a
 * ⭐️ logged at 00:01 writes to a day the cached query never read, and the
 * page doesn't budge.
 */
export function useToday(): string {
  const [day, setDay] = useState(localDay);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setDay(localDay());
      const now = new Date();
      // A hair past midnight, so a timer firing early can't land on the same
      // day and spin.
      const next = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0,
        0,
        2,
      );
      clearTimeout(timer);
      timer = setTimeout(tick, next.getTime() - now.getTime());
    };
    tick();
    // Background tabs throttle timers, so re-check when the tab wakes up.
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return day;
}

export function prettyDay(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
