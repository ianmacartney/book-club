# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

This record scopes design work to the React web app in `src/`. The user
confirmed that the current update is web-only. The Expo client in `mobile/`
shares product behavior but is outside this design scope.

## Users

Club members who join through an invitation, report their pushups, contribute
reading notes, and choose books together. Club creators and poll organizers
also manage the relevant club and voting workflows. Ghost members can observe
without participating in book selection.

Open decision: whether the primary audience is the owner's existing friend
group or a broader audience of independent clubs. The current implementation
supports creating and joining multiple private clubs; this is not evidence of
a confirmed growth strategy.

## Product Purpose

Book Club combines shared reading with daily exercise accountability. Members
keep one book moving through a reading rotation, contribute quotes and thoughts,
and track missed commitments using stormy clouds.

## Operating Context

The existing implementation and `README.md` establish these workflows:

- Sign in with a username and password, then create a club or redeem an invite.
- Report pushups Monday through Saturday while a book is active, using each
  member's own calendar day. Sunday is a rest day; pushups pause between books.
- Read one book at a time. Members take turns contributing notes for assigned
  sections, with deadlines calculated in the assigned reader's timezone.
- Nominate and vote for the next book in the Library. Ranked choice is the
  default; a two-pick format followed by a final runoff is also supported.
- The winning nominator prepares sections and a punishment. Starting the next
  book is a separate action and respects the current book's lifecycle.
- Review cloud standings, Sunday summaries, and the club's book history.
- Manage a display name, timezone, invitations, and declared off-grid periods.

## Capabilities and Constraints

- Preserve the documented house rules during web refinement. `README.md` and
  the backend remain the behavioral authority.
- A successful pushup report earns a star. A negative report costs one cloud;
  silence costs two. Late sections and skipped assignments have their own
  documented penalties.
- The member or members with the most clouds when a book finishes owe the
  punishment set for that book. Treat this terminology as existing product copy.
- Member-local timezones affect reports and reading deadlines. Do not present a
  single shared day as authoritative for everyone.
- Preserve saved ballots, voting restrictions, observer permissions, and the
  separation between preparing a winning book and starting its rotation.
- Quotes, thoughts, drafts, book titles, member names, and club names are user
  content. Layouts must accommodate missing and long values.
- Web changes must preserve the shared Convex API contracts and native client.

## Evidence on Hand

- `README.md`: current house rules and product workflows.
- `src/AuthScreen.tsx` and `src/Onboarding.tsx`: account and club entry flows.
- `src/ClubView.tsx`: Today, Book, Library, Clouds, and Club navigation;
  check-ins and recent history.
- `src/BookTab.tsx`: section submissions, advance drafts, and book setup.
- `src/VoteTab.tsx` and `src/LibraryTab.tsx`: nominations, voting, winner setup,
  and the reading archive.
- `src/StandingsTab.tsx` and `src/ClubTab.tsx`: standings, summaries, membership,
  profile, invites, and absences.
- Product descriptions above are grounded in these files. No adoption numbers,
  testimonials, commercial positioning, or performance claims were supplied.

## Product Principles

Derived from the current product behavior and the confirmed web-only scope:

1. Make a member's next action and its current state easy to understand.
2. Keep deadlines, penalties, and saved state explicit and accurate.
3. Respect the differences between participants, organizers, and observers.
4. Preserve the club's accumulated notes and reading history.
5. Improve daily usability without changing the underlying house rules.
