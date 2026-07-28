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
  the lockfile. Verify a fix survives a clean container before rebuilding:
  `npm ci --cache /tmp/throwaway` (empty cache forces a fresh fetch + integrity
  check). If EAS ever fails at install again after an auth bump, re-pin to the
  new commit sha `@reboot` resolves to (read it from the tarball's
  `x-commit-key` response header).
- **The shared `../convex/_generated` import (this failed build #4, the
  Bundle JavaScript phase).** The app imports the generated Convex API from
  *outside* `mobile/`. **EAS Build uploads only the `mobile/` directory** (no
  npm workspaces), so the parent `convex/` is absent in the cloud and Metro's
  bundle phase dies with "Unable to resolve module ../convex/_generated/api".
  Reproduce locally by bundling an isolated copy of just `mobile/`:
  `git archive HEAD:mobile | tar -x -C /tmp/x && cd /tmp/x && npm ci && npx expo export --platform ios`.
  Fix (in place): the runtime `api.js` is fully generic (`api = anyApi`), so
  `metro.config.js` redirects the runtime import of `.../convex/_generated/api`
  to a local generic copy (`convex-generated/api.js`). The import paths in the
  app are unchanged, so **`tsc` still type-checks against the real
  schema-typed generated `.d.ts`**; only Metro's runtime resolution is
  shimmed. `dataModel` is an `import type`, stripped before it hits the
  resolver. Keep `experiments.onDemandFilesystem: "UNSTABLE_ALLOW_ALL"` (it's
  what makes local dev/type resolution work out-of-root). If the app ever
  imports a *new* value (not type) from `convex/_generated`, extend the shim.
- **Reading a failed build's logs.** The web log viewer needs auth and the raw
  log file is a non-standard binary. Fastest path: `eas build:view <id>` for
  metadata, or query the GraphQL API with your CLI session for the structured
  error:
  ```sh
  TOKEN=$(node -e "process.stdout.write(require(require('os').homedir()+'/.expo/state.json').auth.sessionSecret)")
  curl -s https://api.expo.dev/graphql -H "expo-session: $TOKEN" \
    -H 'content-type: application/json' \
    -d '{"query":"query{builds{byId(buildId:\"<BUILD_ID>\"){error{errorCode message}}}}"}'
  ```

## Suggested cadence for this club

1. Wire auth (NOTES-auth.md), flip `DEMO_MODE` off, test on your own phone
   with a dev build (`npx expo run:ios --device`).
2. First EAS builds; you + one guinea pig (Henry's usually game) on
   TestFlight for a week.
3. Add the rest of the club. Announce in the chat that stars now live here.
4. Iterate over EAS Update; rebuild binaries only on SDK bumps.

## Costs, total

| Thing | Cost |
|---|---|
| Apple Developer | $99/yr (the only real cost) |
| Google Play (optional) | $25 once |
| Expo/EAS free tier | $0 — plenty for a 5-person club |
| Convex push component | usage-priced, negligible at this volume |
