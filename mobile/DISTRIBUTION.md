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
2. **Wire the project**
   ```sh
   cd mobile
   npm i -g eas-cli        # or use npx eas-cli
   eas init                # links the app, writes extra.eas.projectId
   eas build:configure     # writes eas.json with build profiles
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

Setup: `npx expo install expo-updates && eas update:configure` (one-time,
adds the updates URL + runtime version to app.json). Keep
`runtimeVersion: { policy: "appVersion" }` so an OTA update never lands on
an incompatible binary.

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
