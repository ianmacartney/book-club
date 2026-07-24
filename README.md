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
- **Picking the next book.** Everyone nominates two books (punishment
  included). Everyone votes for up to two — at most one of their own. The top
  two go to a runoff (or three-plus if there's a tie for first). One vote each
  in the runoff.
- **Every Sunday** a summary of everyone's stormy clouds is compiled.

## Development

```sh
npm install
npx convex dev        # provision/link a dev deployment (writes .env.local)
npx @convex-dev/auth  # one-time: generates AUTH_PRIVATE_KEY / AUTH_JWKS
npm run dev           # vite + convex dev, in parallel
```

Auth is username + password via Convex Auth v2 (`@convex-dev/auth@reboot`,
installed from pkg.pr.new — still alpha). The auth components (`core`,
`authPasswordProvider`) are mounted in `convex/convex.config.ts`.

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
  Book, Vote, Clouds, and Club.
