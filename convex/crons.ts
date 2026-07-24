import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Runs hourly because every member's midnight is different: shortly after a
// member's day ends we bill missed pushups, and shortly after a due day
// lapses we bill overdue sections.
crons.interval(
  "daily rollover",
  { hours: 1 },
  internal.rollover.processAll,
  {},
);

crons.weekly(
  "sunday summary",
  { dayOfWeek: "sunday", hourUTC: 20, minuteUTC: 0 },
  internal.summaries.compileAll,
  {},
);

export default crons;
