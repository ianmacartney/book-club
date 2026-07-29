import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Runs hourly (on the hour) because every member's midnight is different:
// shortly after a member's day ends we bill missed pushups, and shortly
// after a due day lapses we bill overdue sections.
crons.hourly(
  "daily rollover",
  { minuteUTC: 0 },
  internal.rollover.processAll,
  {},
);

// Fine-grained because reminder times are member-local wall-clock times;
// each run is a cheap scan of notificationPrefs and sends at most one nudge
// per member per local day.
crons.interval(
  "pushup reminders",
  { minutes: 15 },
  internal.notifications.sendReminders,
  {},
);

crons.weekly(
  "sunday summary",
  { dayOfWeek: "sunday", hourUTC: 20, minuteUTC: 0 },
  internal.summaries.compileAll,
  {},
);

export default crons;
