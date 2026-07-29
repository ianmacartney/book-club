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

**Androids:**
```sh
eas build --platform android --profile preview   # produces an .apk
```
Send the build-page link from the Expo dashboard (or the artifact URL) to
the chat; they enable "install from unknown sources" and tap it. New binary
= new link, but again, EAS Update means that's rare.

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
4. **Ship to yourself first:** `npm run ota:preview` publishes to the `preview`
   channel, which only your preview build listens to — the club's production
   installs don't see it.
5. **Promote the exact bundle you tested:** `npm run ota:promote`
   (`update:republish` from preview → production). This re-publishes the same
   artifact rather than rebundling, so what the club gets is byte-for-byte what
   you verified.
6. **If it's bad:** `npm run ota:rollback` returns production to the update
   embedded in the installed binary.

Native changes (SDK bump, new native module, app.json plugin/permission edits)
can't go out over the air — those need `npm run build:ios` + `submit:ios`.

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
  resolver. Keep `experiments.onDemandFilesystem: "UNSTABLE_ALLOW_ALL"` (it's
  what makes local dev/type resolution work out-of-root). If the app ever
  imports a *new* value (not type) from `convex/_generated`, extend the shim.
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
