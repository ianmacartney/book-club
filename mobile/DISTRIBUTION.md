# Shipping the app to the club

Five friends, two platforms, no App Store review drama. The plan: **EAS Build
for binaries, TestFlight for iPhones, direct APK for Androids, EAS Update for
everything after that.** You only build native binaries when the native layer
changes; day-to-day JS/UI changes ship over the air in minutes.

## One-time setup (~1 evening)

1. **Accounts**
   - Expo account (free tier is fine: 30 cloud builds/month, 1k MAU of
     EAS Update — way beyond this club).
   - Apple Developer Program, $99/yr — required for TestFlight. There is no
     other sane way to keep an iOS app on 4 friends' phones (ad-hoc installs
     expire in 7 days without an MDM setup; don't).
   - Google Play developer account only if you ever want the Play Store
     ($25 once). For a handful of Androids, a direct APK link is simpler.
2. **Wire the project** — *already done in this repo.* The app is linked
   (`extra.eas.projectId` in app.json, owner `ianatconvex`), `eas.json` has
   `development`/`preview`/`production` profiles, and `expo-updates` is
   installed + configured (`updates.url` + `runtimeVersion.appVersion` in
   app.json). For reference, the from-scratch version is:
   ```sh
   cd mobile
   npm i -g eas-cli        # or use npx eas-cli
   eas init                # links the app, writes extra.eas.projectId
   eas build:configure     # writes eas.json with build profiles
   npx expo install expo-updates && eas update:configure
   ```
   `eas init` writing `projectId` into app.json is also what makes
   `getExpoPushTokenAsync` work (see `src/notifications.ts`).
3. **Check the identifiers** — `com.pushupclub.app` (both platforms, set in
   app.json). Change before first build if you want something else; it's
   painful after.
4. **Push credentials**
   - iOS: EAS manages the APNs key automatically on first build. Done.
   - Android: FCM — `eas credentials`, add the Firebase service account key
     (one Firebase project, 10 minutes). Expo's push service uses it under
     the hood; no client code changes.
   - The backend sends via Expo's push API (the Convex
     `expo-push-notifications` component). Optional hardening: set
     `EXPO_ACCESS_TOKEN` env on the deployment + enable push security in the
     Expo dashboard.

## Getting it on phones

**iPhones (most of the club):**
```sh
eas build --platform ios --profile production
eas submit --platform ios      # uploads to App Store Connect
```
In App Store Connect → TestFlight → add the guys as internal testers by
email (up to 100, no review needed for internal testing). They install the
TestFlight app, tap the invite, done. Builds live for 90 days — with EAS
Update you'll rarely need a new binary, but expect to push a fresh build a
few times a year.

**Androids:** not a target right now — `expo.platforms` is `["ios"]`, so
exports and updates are iOS-only (and preflight is ~2× faster for it). The
`android` block in app.json is inert but kept for whenever that changes; flip
`platforms` back to `["ios","android"]` and it wakes up.

## What the club actually experiences

| | `npm run submit:ios` (new binary) | `npm run ota:production` (OTA) |
|---|---|---|
| Notified? | Yes — TestFlight pushes "new build available" | **No notification at all** |
| Action needed? | Open TestFlight, tap Update — unless they've turned on TestFlight's per-app **Automatic Updates**, which installs it for them | Nothing |
| When it lands | After App Store Connect finishes processing (~5–15 min); internal testers need no review | Downloads silently in the background, then a **"New version ready → Restart"** banner lets them apply it on the spot; ignored, it applies on the next cold start |
| Good for | native changes, and refreshing the binary so *new* installs start current | day-to-day JS/UI/asset changes |

Left to itself, `expo-updates` boots from the bundle it already has, fetches the
new one in the background, and only swaps it in on the following cold start — so
the club would see a change on their second open, not their first. `src/updates.tsx`
(`<UpdateBanner />`, mounted under the header in App.tsx) closes that gap: when a
download finishes it shows "New version ready → Restart", which calls
`Updates.reloadAsync()`. Dismissing it is fine — the update still applies on the
next cold start. It also re-checks when the app returns to the foreground (at
most every 5 minutes), because the built-in check only runs at launch and this
app tends to stay open.

The banner can't appear in a dev build or Expo Go (`Updates.isEnabled` is false
there, and the check/fetch/reload APIs reject), so it only ever shows in
TestFlight/production builds.

An OTA only reaches builds whose `runtimeVersion` matches. Ours is the
`appVersion` policy, and `production` in eas.json bumps only the *build number*
(`autoIncrement` + `appVersionSource: remote`), so `version` stays `1.0.0` and
one OTA covers every 1.0.0 build. Bumping `expo.version` in app.json splits that
— old installs stop receiving new updates until they get a new binary.

### How channels actually target people

A channel isn't a group of people — **it's compiled into the binary** from the
eas.json profile's `channel`. A build made with `--profile production` only ever
looks at the `production` channel, so the club's installs *cannot* see preview
updates; it's not a permission, it's that they never ask.

"Preview targets my phone only" is therefore true only in the sense that you'd
be the only person holding a preview-profile build. Two caveats before relying
on it:

- You have to actually build one (`eas build --profile preview`), and internal
  distribution needs your device registered (`eas device:create`).
- **It shares `com.pushupclub.app` with production**, so installing a preview
  (or a local `npm run device` dev build) *replaces* the TestFlight app on your
  phone. To run both side by side you'd need an app variant — app.config.js
  switching `bundleIdentifier`/`name` off an env var.

At four users, a staging channel usually isn't worth that. Test locally with
`npm run device`, then `npm run ota:production`, and keep `npm run ota:rollback`
in your back pocket.

## Testing a change before it goes out

Every cloud failure so far was reproducible locally in seconds. `npm run
preflight` (~10s) is the gate — run it before any build or OTA push. It's
wired into `build:*` and `ota:preview` so you can't skip it by accident.

| Script | What it does | Catches |
|---|---|---|
| `npm run typecheck` | `tsc --noEmit` | type errors (OTA pushes bypass this otherwise) |
| `npm run verify:deps` | re-downloads URL deps, compares to lockfile `integrity` | pkg.pr.new drift → install-phase EINTEGRITY |
| `npm run verify:bundle` | local `expo export --platform all` | bundle errors on the path `eas update` uses |
| `npm run verify:eas` | `npm ci` + export in a **copy of only `mobile/`** | anything unresolvable outside `mobile/` |
| `npm run preflight` | all four | every failure we've actually hit |
| `npm run build:why` | prints a failed build's real error via GraphQL | saves fighting the log viewer |

**Both bundle checks are needed, because the two commands bundle in different
places:** `eas build` bundles **in the cloud** from git-visible files only —
that's what `verify:eas` mimics. `eas update` bundles **locally on your
machine**, where gitignored state like `.expo/` also participates — that's what
`verify:bundle` covers. A change can break one and not the other, which is
exactly how the `platforms`/web failure below slipped through a sandbox-only
check.

`verify:eas` is the important one for builds: a plain `expo export` passes even
when the cloud can't build, because the parent `convex/` is sitting next to you
locally.
It copies the git-visible contents of `mobile/` (tracked + untracked-but-not-
ignored, so uncommitted work is included) to a temp dir where no parent
`convex/` exists, then does a clean `npm ci` + export — the same conditions as
the build container.

### The recommended loop

1. **Iterate locally.** `npm run dev` (Metro against a dev build) or
   `npm run ios` for the simulator. Everything except push works here.
2. **Push notifications need a real device** — the simulator can't register
   with APNs at all. `npm run device` (cabled dev build) or install a
   `preview`/TestFlight build, then grant permission in Club → Notifications.
3. **Gate it:** `npm run preflight`.
4. **Ship it.** While you're the only one installed, `npm run ota:production`
   straight to the club's channel is fine — preflight already gates it, and
   `ota:rollback` is one command away.
   Once the club is actually on production and a bad update would be visible to
   them, switch to the two-step: `npm run ota:preview` (only your preview build
   listens to that channel) → verify on your phone → `npm run ota:promote`,
   which `update:republish`es the *same artifact* to production rather than
   rebundling, so the club gets byte-for-byte what you checked.
5. **If it's bad:** `npm run ota:rollback` returns production to the update
   embedded in the installed binary.

Before an OTA that depends on new backend functions, make sure the deployment
is current (`npm run deploy:dev` from the repo root) — the app talks to the dev
deployment, and OTA'd UI calling an undeployed function fails at runtime.

Native changes (SDK bump, new native module, app.json plugin/permission edits)
can't go out over the air — those need `npm run build:ios` + `submit:ios`.

### Release tags

Shipping tags the commit, so months later you can answer "which code is the club
running?" without guessing. It's wired into the ship scripts — nothing to
remember:

| Tag | Written by |
|---|---|
| `mobile-ota/<timestamp>` | `npm run ota:production` |
| `mobile-build/<timestamp>` | `npm run build:ios` |
| `web-dev/<timestamp>` | `npm run deploy:dev` (repo root) |

`npm run releases` (repo root) lists them newest-first with their annotations —
commit, subject, and the app version that gates OTA delivery.

Those scripts **refuse to ship a dirty tree**, and deliberately check *before*
doing any work rather than after. `eas update` and `vite build` bundle the
working tree, so shipping with uncommitted changes publishes code that exists in
no commit — and the tag would point at something you didn't ship. `ALLOW_DIRTY=1
npm run ota:production` overrides it and skips the tag, which is occasionally
right for a hotfix and never right routinely.

`ota:preview` and `ota:promote` aren't tagged: preview is scratch space, and
`promote` republishes an artifact built from an older commit, so a tag on HEAD
would misattribute it. The EAS dashboard is the record for those.

## Day-to-day updates

```sh
eas update --branch production --message "feed polish"
```
JS/asset changes reach every installed app on next launch — no TestFlight
review, no re-install. Native changes (new Expo SDK, new native module) need
a new `eas build` + TestFlight/APK round.

Setup is already done (`expo-updates` installed, `eas update:configure` ran,
adding the updates URL + `runtimeVersion` to app.json). Keep
`runtimeVersion: { policy: "appVersion" }` so an OTA update never lands on
an incompatible binary — bump `expo.version` in app.json whenever you ship a
new binary so OTA and native stay matched.

## Gotchas that will bite a cloud build

- **pkg.pr.new integrity drift (the one that failed build #3).** `@convex-dev/auth`
  is installed from a pkg.pr.new URL. It was pinned to the **moving `@reboot`
  tag**, whose tarball upstream republishes in place. Local `npm ci` passes
  from cache, but EAS's clean container re-downloads the *current* tarball,
  its hash no longer matches the lockfile `integrity`, and `npm ci` dies with
  EINTEGRITY in the **Install dependencies** phase. Fix: pin to the immutable
  commit URL (`@convex-dev/auth@<sha>`, currently `@348fb3a`) and regenerate
  the lockfile. **`npm run verify:deps` detects this** and prints the exact
  `npm pkg set` command to re-pin (it reads the current commit from the
  tarball's `x-commit-key` header). Re-pin rather than going back to `@reboot`
  after any auth bump, or the failure returns.
- **pkg.pr.new disappearing entirely.** Separate failure from drift: the whole
  package can start 404ing ("Registry or repository not found") for *every*
  URL form, tag and commit sha alike — builds there aren't kept forever. Seen
  2026-07-29. While it lasts, **cloud builds can't install and will fail**, but
  **OTA is unaffected** (`eas update` bundles from the `node_modules` you
  already have) — so you can still ship JS to the club, just not cut a binary.
  `verify:deps` warns without failing, since an unreachable URL says nothing
  about integrity. The durable fix if it recurs is to vendor the tarball into
  `mobile/` (`npm pack` the installed copy, commit it, depend on
  `file:vendor/...`), which removes the network from the critical path; the
  reboot line isn't on the npm registry, so there's no registry fallback.
- **Never run `npm ci` while a dependency source is down.** `npm ci` *deletes*
  `node_modules` before installing, so a failed install leaves you with nothing
  and no way to reinstall — it takes out local dev, `expo export`, and OTA all
  at once. Recovery, as long as the tarball is still in the npm cache:
  `npm ci --offline`. Prefer `npm install` (non-destructive) when you're unsure
  upstream is healthy, and keep `verify:deps` (which only fetches, never
  installs) as the thing you run to check.
- **The shared `../convex/_generated` import (this failed build #4, the
  Bundle JavaScript phase).** The app imports the generated Convex API from
  *outside* `mobile/`. **EAS Build uploads only the `mobile/` directory** (no
  npm workspaces), so the parent `convex/` is absent in the cloud and Metro's
  bundle phase dies with "Unable to resolve module ../convex/_generated/api".
  **`npm run verify:eas` reproduces this locally** (bundles a copy of only
  `mobile/`); a plain `expo export` will not, since the real `convex/` is right
  next to you.
  Fix (in place): the runtime `api.js` is fully generic (`api = anyApi`), so
  `metro.config.js` redirects the runtime import of `.../convex/_generated/api`
  to a local generic copy (`convex-generated/api.js`). The import paths in the
  app are unchanged, so **`tsc` still type-checks against the real
  schema-typed generated `.d.ts`**; only Metro's runtime resolution is
  shimmed. `dataModel` is an `import type`, stripped before it hits the
  resolver. If the app ever imports a *new* value (not type) from
  `convex/_generated`, extend the shim.
- **`experiments.onDemandFilesystem` breaks `eas update`.** app.json used to
  carry `"onDemandFilesystem": "UNSTABLE_ALLOW_ALL"` so Metro could read
  out-of-root. EAS Update validates the manifest server-side and rejects it —
  `Manifest Validation Error: experiments/onDemandFilesystem: must be boolean`
  → `Failed to publish updates`. The metro.config.js redirect above had already
  made the flag redundant, so it's simply removed (2026-07-29). Don't add it
  back; if you ever need out-of-root reads again, the schema-legal value is a
  boolean.
- **`eas update` exporting the web platform.** `expo.platforms` was absent in
  app.json, so it defaulted to `["ios","android","web"]`. Both `eas build` and
  `eas update` export with `--platform=all`, so the export tried to bundle web,
  which needs `react-native-web` — correctly not installed, since this is a
  native-only app (the web experience is the separate Vite SPA at the repo
  root). Symptom: `CommandError: It looks like you're trying to use web support
  but don't have the required dependencies installed` → `Export failed` → `update
  command failed`. Fix: `"platforms": ["ios", "android"]` in app.json (the inert
  `web.favicon` block was dropped too). Don't add `react-native-web` — that
  would ship a web bundle nobody uses. `npm run verify:bundle` catches this.
- **Reading a failed build's logs.** Use **`npm run build:why`** (most recent
  failure) or `npm run build:why -- <build-id>`. It pulls the structured error
  through the GraphQL API with the session eas-cli already stored, and suggests
  which verify script reproduces it. Don't bother with the log artifact — it's
  an undocumented binary blob, not gzip, and the web viewer needs auth.

## Suggested cadence for this club

1. Auth is wired (NOTES-auth.md). Test on your own phone with a dev build
   (`npm run device`) — that's also the only way to exercise push, since the
   simulator can't register with APNs.
2. `npm run build:ios` then `npm run submit:ios`; you + one guinea pig
   (Henry's usually game) on TestFlight for a week.
3. Add the rest of the club. Announce in the chat that stars now live here.
4. Iterate over EAS Update (`ota:preview` → verify → `ota:promote`); rebuild
   binaries only on SDK bumps or other native changes.

## Costs, total

| Thing | Cost |
|---|---|
| Apple Developer | $99/yr (the only real cost) |
| Google Play (optional) | $25 once |
| Expo/EAS free tier | $0 — plenty for a 5-person club |
| Convex push component | usage-priced, negligible at this volume |
