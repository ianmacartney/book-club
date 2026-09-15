# 📚 Book Club — ⭐️ or ⛈️

An invite-only club app: daily pushups, one book at a time, and stormy clouds
for whoever slacks. Built on [Convex](https://convex.dev) with
[Convex Auth v2](https://auth-v2.previews.convex.dev/), React 19, Vite, and
Tailwind CSS 4.

## House rules

- **Pushups, Monday–Saturday.** Report during your own calendar day (your
  timezone): ⭐️ if you did them, ⛈️ if you didn't (1 cloud). Say nothing and
  the nightly rollover bills you ⛈️⛈️ (2 clouds). Sunday is a rest day.
- **One book at a time.** The book is split into sections, divvied round-robin
  through the member rotation. When the previous section lands, the next
  reader has **2 calendar days** (their timezone) to post quotes + thoughts.
- **Late?** Every day past due costs ⛈️⛈️. Once you're overdue, the next
  reader can submit your section for you — a "skip" — which costs you an
  extra ⛈️⛈️ on top.
- **The reckoning.** When the last section is submitted, whoever has the most
  stormy clouds loses and owes the punishment set by the member who suggested
  the book.
- **Picking the next book.** Open nominations in the Library on web or mobile,
  usually in the last few sections of the current book. Each active member
  can nominate up to two. Ranked choice is the default voting format.
- **Ranked choice.** Rank any number of books, favorite first, including
  someone else's book.
  The lowest book is eliminated and its votes transfer to each ballot's next
  remaining choice until a book has a majority of non-exhausted ballots.
- **Two picks + final runoff (optional).** This format allows one or two picks,
  including at least one nominated by someone else, followed by a one-vote
  final between exactly two books. A lone self-vote is not a valid first-round
  ballot. Choose this format when opening nominations.
- **Ties and closing rounds.** A random draw, published before voting, breaks
  ties for a finalist spot or ranked elimination; earlier in the draw keeps
  its place. A tied final gets a fresh two-book vote. Ballots can be changed
  until all active members have voted (automatic tally), or the poll organizer
  or club creator closes the round early. Completed counts remain visible.
  Ghosts can watch but cannot nominate, vote, or manage the selection.
- **After the result.** Only the winning nominator can save sections and a
  punishment. This can happen while the current book is still underway.
  A separate **Start reading** action begins the rotation and deadlines once
  the current book is over. A winner cannot be started twice or replaced by
  another poll before it starts; the direct-start shortcut also respects this.
- **Every Sunday** a summary of everyone's stormy clouds is compiled.

## Development

```sh
npm install
npx convex dev        # provision/link a dev deployment (writes .env.local)
npx @convex-dev/auth  # one-time: generates AUTH_PRIVATE_KEY / AUTH_JWKS
npm run dev           # vite + convex dev, in parallel
```

Auth is username + password via Convex Auth v2 (`@convex-dev/auth`
`^2.0.0-alpha.1` from npm — still alpha, and the caret means a fresh install
can move it). The auth components (`core`, `authPasswordProvider`,
`authUsername`) are mounted in `convex/convex.config.ts`; token lifetimes are
set in `convex/auth.ts`.

## How it hangs together

- `convex/schema.ts` — users, clubs, memberships, invite codes, daily
  check-ins, the stormy-cloud ledger, books/sections, polls/nominations/votes,
  Sunday summaries.
- `convex/lib/days.ts` — every deadline is a `yyyy-MM-dd` string reckoned in
  the member's own IANA timezone; this file is the only place timezones and
  wall clocks meet.
- `convex/rollover.ts` — hourly cron: bills missed pushups after each
  member's midnight, and accrues late-section clouds (idempotent per
  section + day).
- `convex/summaries.ts` — Sunday 20:00 UTC cron: per-club weekly snapshot.
- `src/` — Vite + React 19 + Tailwind 4 single-page app with tabs for Today,
  Book, Library, Clouds, and Club.
- `convex/polls.ts` and `convex/lib/voting.ts` — selection lifecycle and ranked
  counting; covered with authenticated in-memory scenarios in `polls.test.ts`.
- `src/VoteTab.tsx` and `mobile/src/screens/NextBookPoll.tsx` — book selection
  and winner setup in each client's Library.
