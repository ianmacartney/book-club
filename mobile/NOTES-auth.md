# Mobile auth wiring — how it works (done)

Auth is live: Convex Auth v2 (`@convex-dev/auth@reboot`, same pinned
pkg.pr.new build as the web app) with username + password against the shared
dev deployment (`expo.extra.convexUrl` in app.json).

## The pieces

- **Providers** (`App.tsx`): `ConvexAuthProvider` wraps the app with
  `storage` set to an `expo-secure-store` adapter (`src/convex.ts`) — tokens
  live in the device keychain. `AuthLoading` / `Unauthenticated` /
  `Authenticated` gate the tree.
- **Screens**: `src/screens/AuthScreen.tsx` (log in / create account, full
  structured-`userError` handling mirroring the web) and
  `src/screens/JoinClubScreen.tsx` (invite-code redemption for a signed-in
  but clubless user).
- **After sign-in** (`SignedIn` in App.tsx): `users.ensureTimezone` with the
  device timezone, and a silent push-token refresh
  (`currentPushTokenIfPermitted` → `notifications.registerPushToken`) that
  never prompts — the explicit permission ask lives in Club → Notifications.
- **Data layer** (`src/data.ts`): thin hooks over the shared generated API
  (`useQuery`/`useMutation`), screens consume the wire shapes in
  `src/types.ts`. The feed pages backwards through day windows with
  `useQueries`, pinning older windows by their `nextThrough` cursor.

## React Native runtime gotcha: `window.addEventListener`

RN defines `window` (it's the global object) but no DOM event APIs. The auth
session manager's cross-tab storage listener guards on `typeof window`
alone, so `init()` threw `TypeError: undefined is not a function` at launch.
`src/polyfills.ts` (first import in index.ts) installs no-op
`window.addEventListener`/`removeEventListener`. Upstream fix for the auth
package: guard on `typeof window.addEventListener === "function"` in
`#attachStorageListener`/`dispose` instead.

## The Metro gotcha (SDK 57) — read before touching config

Importing the shared `../convex/_generated/api` from inside `mobile/`
initially failed to resolve. Do **not** add a `metro.config.js` with
`watchFolders`/`nodeModulesPaths` — the SDK 57 docs say to delete that
manual monorepo config, and it doesn't fix this anyway.

The cause: SDK 57's on-demand filesystem scopes lazy out-of-root reads to
the Metro *server root*, and without npm workspaces the server root is
`mobile/` itself. The fix (in app.json, the escape hatch the Expo CLI
explicitly supports):

```json
"experiments": { "onDemandFilesystem": "UNSTABLE_ALLOW_ALL" }
```

If this experiment flag ever disappears in an SDK upgrade, the durable
alternative is making the repo an npm workspace (root `package.json`
`"workspaces": ["mobile"]`) so Expo detects the repo root as the server
root — at the cost of dependency hoisting.

Keep the root and mobile `convex` package versions aligned — the generated
`api.js` resolves `convex` from the root `node_modules`.

## Still open

- Testing on a real device (`npx expo run:ios --device`); push needs a dev
  build, not Expo Go.
- `eas init` writes `extra.eas.projectId`, which
  `getExpoPushTokenAsync` wants in a standalone build (see DISTRIBUTION.md).
