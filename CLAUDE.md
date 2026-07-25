# Book Club

Vite + React SPA on a Convex backend. Auth via `@convex-dev/auth` (component
mounted at `/auth`). The frontend is served by the `@convex-dev/static-hosting`
component, which owns `/` on the deployment's `.convex.site` domain.

## Deploying (hosting)

The app is hosted on Convex static hosting. **Dev deployment** is live at
https://secret-barracuda-975.convex.site.

Re-deploy **only when your changes are stable** — i.e. `npm run typecheck`
passes and you've verified the change works. Then:

```bash
npm run deploy:dev
```

This pushes the backend (`convex dev --once`) and then builds + uploads the
frontend to the **dev** deployment (`static-hosting upload --build`). The
`--build` step runs `npm run build`, which typechecks first, so a broken build
will not ship.

Notes for agents:
- **Don't re-deploy after every edit.** Static hosting is a publish target, not
  a dev server. During active work use `npm run dev` (Vite HMR + `convex dev`).
  Deploy once when a unit of work is stable.
- **Coordinate in shared workspaces.** If another thread is mid-edit on backend
  files (e.g. `convex/books.ts`) the typecheck in `npm run build` may fail.
  Don't deploy until the tree is stable. To ship just the frontend past a known
  backend type error, bypass the typecheck:
  `static-hosting upload --build-command "npx vite build"`.
- **Production** (separate `descriptive-bullfrog-96` deployment) is not wired to
  a script yet. Ship prod deliberately with `static-hosting deploy` (targets
  prod, runs the full typechecked build).
- Static routing: the component owns `/`; auth keeps `/auth`; any app-owned
  `convex/http.ts` routes live under `/api` (see `convex/convex.config.ts`).

# Data administration guide

The club rules: daily pushups Mon–Sat (⭐ = did them, ⛈ = didn't = 1 cloud,
silence = 2 clouds), one book at a time read in rotation (2 calendar days per
section, 2 clouds per late day, skips cost 2 extra), most clouds at book end
owes the punishment. Auth v2 docs snapshot: `.context/auth-v2-docs.md`.

**This deployment holds the club's real data** (8 years imported from
iMessage). Never insert test data; verify reads with queries before writes.

## The club

Club: "Push Up Club" — id `kh7bzpeb6gfb3ty6s1qwhqe3kh8b4fhe`.

| Name  | Username | Timezone | iMessage handle |
|-------|----------|----------|-----------------|
| Peter | peterdmacartney@gmail.com | America/Denver | +13033358826 |
| Henry | Schoony | America/Los_Angeles | +15038960704 |
| Billy | Bward006 | America/New_York | +13157203272 |
| Ian S | iansugg@gmail.com | America/Denver | +13039468395 |
| Ian M | Ian M | America/Los_Angeles | "me" in exports |
| Tucker | tucker-ghost | America/New_York | +12696153899 — **ghost**: ex-member (2018–2021), has a users row but no membership; appears in old books, accrues nothing new |

Watch out: "Schoony" is HENRY's username (not a Billy nickname). "Pete" =
Peter. Admin mutations match members by display name OR username,
case-insensitive (see `memberByName` in `convex/setup.ts`).

## Data model conventions

- **Days are strings** (`yyyy-MM-dd`) in the *member's own timezone*, never
  UTC. Convert timestamps with the member's tz before writing. Helpers:
  `convex/lib/days.ts`.
- **Clouds ledger** (`clouds` table): `pushups_storm` = 1 (self-reported ⛈),
  `pushups_missed` = 2 (silence on a required day), `section_late` = 2/day
  past due, `section_skip` = 2 (someone covered your section). Pushup clouds
  have no `clubId` (they count in every club); section clouds carry
  `clubId`/`bookId`/`sectionId`.
- **Finished books freeze their result** (`books.result.tallies` +
  `loserIds`). Historical standings never recompute from the ledger when a
  result exists — to fix an old standing, patch `result`, don't touch clouds.
- Sections are sequential: only the first unsubmitted one is "current". Due
  day = previous submission day + 2, in the assignee's tz. The hourly cron
  (`convex/rollover.ts`) bills late days and missed pushups idempotently;
  `submitSection` also settles outstanding late days at submission time.

## Admin mutations (`convex/setup.ts`, all via `npx convex run`)

All are idempotent and match people by name/username.

```sh
# Fix or record a check-in for a specific local day (REPLACES the existing
# row + its pushup clouds — safe for corrections):
npx convex run setup:backfillCheckin \
  '{"clubId":"<club>","userName":"Billy","day":"2026-07-21","status":"missed"}'
# status: "star" (0 clouds) | "storm" (1) | "missed" (2)

# Record a section submission that happened off-app (next unsubmitted section
# only; bills late days up to that day, removes cron overbilling dated after
# it, chains the next due day, finishes the book on the last section):
npx convex run setup:backfillSubmission \
  '{"bookId":"<book>","sectionIndex":3,"byName":"Ian M","day":"2026-07-26","quotes":"…","thoughts":"…"}'
# If byName ≠ assignee it records a skip (+2 clouds to the assignee).

# Start a book with explicit rotation/suggester/backdate:
npx convex run setup:startBookAsAdmin '{"clubId":"<club>","title":"…",
  "punishment":"…","suggestedByName":"Peter",
  "rotationNames":["Peter","Henry","Billy","Ian M","Ian S"],
  "sectionTitles":["Book 1","…"],"startedDay":"2026-07-20"}'

# Historical imports: setup:importPastBook (whole finished/abandoned book,
# dedupes on title+startedDay), setup:importCheckins (bulk, insert-if-absent,
# never clobbers app data), setup:createGhostUser (ex-members).
```

Member-scoped queries need an identity (subject = users table id):

```sh
npx convex run clubs:home '{"clubId":"<club>"}' --identity '{"subject":"<usersId>"}'
```

## iMessage sync pipeline

Source of truth for pre-app history is the group chat "Push-up Club"
(chat #23 in the Messages DB).

1. Get a readable DB copy — macOS blocks `~/Library/Messages/chat.db` behind
   Full Disk Access, so have the user copy it to `tmp/chat.db`.
2. `node scripts/export-imessage.mjs --db tmp/chat.db --list` to find chats;
   `--chat 23 --out tmp/pushup-club.json` for the full export (handles
   `attributedBody` blobs and BigInt dates).
3. Parse: check-ins are short bare-emoji messages (⭐/🌟 star, ⛈ storm);
   exclude tapbacks (`Liked "…"`, `Loved "…"`, …); convert each to the
   sender's local day. Books kick off with plan messages (page allocations
   per person) and end with "Final Tally" messages (official clouds per
   member — authoritative over ledger math).
4. Import: `python3 scripts/import-history.py <clubId>` runs the archive from
   `.context/books-merged.json` + `tmp/checkins.json` (era sources:
   `.context/books-era{1..4}.json`). All idempotent.

**Day-attribution caveat**: members sometimes report just after midnight, so
a 1am ET message lands on the "wrong" local day. When the user corrects you
("X didn't star Tuesday"), fix with `backfillCheckin` — it replaces.

## Gotchas

- `npx convex data <table> --order desc` sorts by *creation time*, not by
  domain day fields — bulk imports bury older app-created rows deep in the
  listing. Don't conclude a row is absent from a truncated listing.
- The hourly cron only bills missed pushups from each member's join day
  (`memberships._creationTime`); pre-app silence is intentionally not billed
  (the official book tallies already embodied it).
- After data changes, sanity-check with `clubs:home` (today's statuses, book
  clouds) and `books:detail` (standings, current section, daysLate).
- Backend deploy: `npx convex dev --once`. Typecheck both configs:
  `npm run typecheck`.
