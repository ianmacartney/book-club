# Book Club

Vite + React SPA on a Convex backend. Auth via `@convex-dev/auth` (component
mounted at `/auth`). The frontend is served by the `@convex-dev/static-hosting`
component, which owns `/` on the deployment's `.convex.site` domain.

## Mobile app (`mobile/`)

Expo (SDK 57) React Native app, chat-feed-first design (`convex/feed.ts`
composes check-ins, submissions, and summaries into the timeline). **Live
against the dev deployment** with Convex Auth v2 (username+password, tokens
in expo-secure-store); how the wiring works — including how the shared
`convex/_generated` import resolves from outside `mobile/` (a `metro.config.js`
redirect, *not* the `onDemandFilesystem` experiment, which breaks `eas update`)
— is documented in `mobile/NOTES-auth.md`. Shipping to
the club is `mobile/DISTRIBUTION.md`. Push notifications are live
server-side via the `@convex-dev/expo-push-notifications` component
(`convex/notifications.ts`): submission/your-turn pushes, a per-user daily
reminder cron (15-min interval), and opt-in star announcements. Before shipping
anything, `cd mobile && npm run preflight` (typecheck, dependency integrity,
local export, and an export from a copy of only `mobile/` — the conditions EAS
builds under).

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

**Every deploy tags the commit it shipped** (`scripts/tag-release.sh`, wired into
the deploy/ship scripts) so "what's actually running?" is answerable from git.
Kinds: `web-dev`, `mobile-ota`, `mobile-build`. `npm run releases` lists them
newest-first. Because publishing bundles the *working tree*, the scripts refuse
to ship a dirty tree — commit first, or `ALLOW_DIRTY=1 npm run …` to ship
untagged (then the deployed code exists nowhere in git, so don't).

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
| Tucker | tucker-ghost | America/New_York | +12696153899 — **ghost**: ex-member (2018–2021) with a `role: "ghost"` membership; watches the club (feed, library, standings) but accrues nothing, and is excluded from every reading rotation. His row is cited by 305 checkins, 12 books, 28 sections — never delete or merge it |

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

# Ghosts: watch the club, owe nothing, never in a rotation. Creates the
# membership if the user has none — the path for giving an ex-member access:
npx convex run setup:setMemberRole \
  '{"clubId":"<club>","userName":"Tucker","role":"ghost"}'   # or "member"

# Delete a duplicate identity from an accidental second sign-up. Refuses
# unless the row is unreferenced everywhere, so it can't eat a real member:
npx convex run setup:deleteOrphanUser '{"userId":"<usersId>"}'

# Historical imports: setup:importPastBook (whole finished/abandoned book,
# dedupes on title+startedDay), setup:importCheckins (bulk, insert-if-absent,
# never clobbers app data), setup:createGhostUser (ex-members).
```

**Signing in claims an existing identity.** `users.createOrUpdateUser` binds a
new account to an account-less `users` row with the same username
(case-insensitive) instead of forking a duplicate — that's how an ex-member like
Tucker signs in and lands on his own history, with no invite code needed (he
already holds a ghost membership). Hijacking an active member isn't possible:
`signUpWithPassword` rejects a username that already has an account
(`USERNAME_TAKEN`) before the callback runs, so only account-less rows are
reachable. Before this existed, a second sign-up forked a new identity — which
is how a duplicate "Peter" appeared on 2026-07-29.

Deleting a `users` row does **not** delete the auth account pointing at it:
component data is only reachable through the component's API and it exposes no
delete, so clear stale accounts in the dashboard under the `core` component's
`accounts` table.

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
