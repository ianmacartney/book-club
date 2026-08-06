/**
 * Wire shapes of the Convex queries the app consumes, written out locally so
 * the UI can run on demo fixtures before auth is wired up. Once the app talks
 * to the real backend these stay valid — they mirror the return values of
 * convex/feed.ts, convex/clubs.ts, convex/books.ts, convex/summaries.ts and
 * convex/notifications.ts (ids relax to plain strings on this side).
 */

export type CheckinStatus = "star" | "storm" | "missed";

export type Member = {
  _id: string;
  name: string;
  timezone: string | null;
  today: string; // yyyy-MM-dd in the member's timezone
  isPushupDay: boolean;
  checkinToday: CheckinStatus | null;
  bookClouds: number;
};

export type Home = {
  club: { _id: string; name: string };
  viewerId: string;
  // Ghosts see everything but owe nothing — no check-ins, no rotation.
  viewerIsGhost: boolean;
  members: Member[];
  ghosts: { _id: string; name: string }[];
  activeBookId: string | null;
};

export type Me = {
  _id: string;
  username: string;
  name: string;
  timezone: string | null;
  today: string;
};

export type FeedReply = {
  replyId: string;
  day: string;
  at: number;
  userId: string;
  name: string;
  body: string;
};

export type FeedEvent =
  | {
      type: "checkin";
      day: string;
      at: number;
      userId: string;
      name: string;
      status: CheckinStatus;
    }
  | {
      type: "submission";
      day: string;
      at: number;
      userId: string;
      name: string;
      bookId: string;
      bookTitle: string;
      sectionId: string;
      sectionIndex: number;
      sectionTitle: string;
      assigneeName: string;
      skip: boolean;
      quotes: string;
      thoughts: string;
      isLastSection: boolean;
      replies: FeedReply[];
    }
  | {
      type: "reply";
      day: string;
      at: number;
      replyId: string;
      userId: string;
      name: string;
      body: string;
      sectionId: string;
      sectionTitle: string;
      bookTitle: string;
      writerName: string;
    }
  | {
      type: "bookStarted";
      day: string;
      at: number;
      bookId: string;
      bookTitle: string;
      author: string | null;
      suggestedByName: string | null;
      punishment: string;
    }
  | {
      type: "bookEnded";
      day: string;
      at: number;
      bookId: string;
      bookTitle: string;
      status: "finished" | "abandoned";
      punishment: string;
      loserNames: string[];
    }
  | {
      type: "weekSummary";
      day: string;
      at: number;
      entries: { name: string; weekClouds: number; bookClouds: number }[];
    };

export type Section = {
  _id: string;
  index: number;
  title: string;
  assignedTo: string;
  assigneeName: string;
  dueDay: string | null;
  submission: {
    by: string;
    byName: string;
    day: string;
    at: number;
    quotes: string;
    thoughts: string;
    skip: boolean;
  } | null;
};

export type BookDetail = {
  book: {
    _id: string;
    title: string;
    author: string | null;
    punishment: string;
    status: "active" | "finished" | "abandoned";
    startedDay: string;
    endedDay: string | null;
    suggestedBy: string | null;
    result: {
      tallies: { userId: string; clouds: number }[];
      loserIds: string[];
    } | null;
  };
  viewerId: string;
  current: {
    sectionId: string;
    daysLate: number;
    skipperId: string;
  } | null;
  sections: Section[];
  standings: { userId: string; clouds: number; name: string }[];
};

export type ShelfBook = {
  _id: string;
  title: string;
  author: string | null;
  // The query never returns "active", but its static type includes it.
  status: "active" | "finished" | "abandoned";
  startedDay: string;
  endedDay: string | null;
  punishment: string;
  loserNames: string[];
};

export type NotificationSettings = {
  hasToken: boolean;
  paused: boolean;
  reminderTime: string | null; // "HH:mm" local, null = off
  notifyOnStars: boolean;
  notifyOnSubmissions: boolean;
};

export type Invite = { _id: string; code: string; forName: string | null };
