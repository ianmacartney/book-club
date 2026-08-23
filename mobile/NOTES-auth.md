# Mobile auth wiring — how it works (done)

Auth is live: Convex Auth v2 (`@convex-dev/auth@d236554`, same pinned
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

## Bumping auth = ship the server AND the phones

An auth bump is **not** a server-only migration, even when every validator
lines up. Upstream #447 turned `signInWithPassword` / `signUpWithPassword`
from actions into mutations. The args and the result unions were untouched, so
a diff of the validators says "compatible" — but the client picks the call
*mechanism* from the function type (`useAction` vs `useMutation`), and Convex
refuses the mismatch:

```
[CONVEX A(auth:signInWithPassword)] Trying to execute auth.js:signInWithPassword
as Action, but it is defined as Mutation.
```

Live sessions kept working (`refreshSession` is a mutation in both), so this
hides: nothing breaks until someone is signed *out*, and then they can't get
back in. Shipped server-only on 2026-08-22 and every phone on the previous OTA
was locked out of the login screen until an `ota:production` went out.

When the auth package moves, compare **function kinds**, not just arg/return
validators, for all four exports (`signInWithPassword`, `signUpWithPassword`,
`refreshSession`, `signOut`) — and publish the OTA in the same sitting as the
backend push.

## Token persistence across app restarts

`storage={secureStorage}` on `ConvexAuthProvider` is what makes a session
survive the app closing, and it is **not** optional. With no `storage`, the
package falls back to `InMemoryStorage` — React Native has a `window` but no
`localStorage` — and every launch starts signed out. As of `@d236554` that
fallback logs a one-time `[convex-auth]` warning naming the problem, so if you
ever see it in the Metro console, the provider lost its `storage` prop.

`TokenStorage` methods may return promises, so the `expo-secure-store` adapter
in `src/convex.ts` needs no buffering of its own: the session manager awaits the
store during `init()` and reports `isLoading` until it resolves, rather than
flashing "signed out" and bouncing to the auth screen.

Storage keys are namespaced by the deployment URL stripped to alphanumerics, so
**pointing `expo.extra.convexUrl` at a different deployment silently signs
everyone out** — the tokens are still in the keychain, under keys the new
namespace never looks up.

### Resolved: the `window.addEventListener` crash

RN defines `window` (it's the global object) but no DOM event APIs, and the
session manager's cross-tab storage listener used to guard on `typeof window`
alone, so `init()` threw `TypeError: undefined is not a function` at launch.
`src/polyfills.ts` shimmed no-op listeners to work around it. Fixed upstream in
convex-auth #465 (`domEventTarget()` now checks for the listener functions and
returns `null` on native), so the shim and its `index.ts` import were deleted.
Restore them if the auth pin is ever rolled back past that commit.

## The Metro gotcha (SDK 57) — read before touching config

Importing the shared `../convex/_generated/api` from inside `mobile/` doesn't
resolve on its own: SDK 57's on-demand filesystem scopes out-of-root reads to
the Metro *server root*, and without npm workspaces that root is `mobile/`
itself. Do **not** "fix" it with `watchFolders`/`nodeModulesPaths` — the SDK 57
docs say to delete that manual monorepo config, and it doesn't help here.

**How it's actually solved:** `metro.config.js` redirects the *runtime* import
of `.../convex/_generated/api` to a local generic copy
(`convex-generated/api.js`) — the generated `api` is just `anyApi`, identical
for every Convex project. Import paths in the app are unchanged, so `tsc` still
type-checks against the real schema-typed `.d.ts` in the parent. The `dataModel`
import is `import type`, erased before it reaches the resolver.

This also fixes EAS Build, which uploads *only* `mobile/` — in the cloud the
parent `convex/` doesn't exist at all.

**Don't reintroduce `experiments.onDemandFilesystem`.** It used to live in
app.json as `"UNSTABLE_ALLOW_ALL"` to permit those out-of-root reads. The Metro
redirect above made it unnecessary, and it actively breaks `eas update`: the
server validates the manifest and rejects the string with
`experiments/onDemandFilesystem: must be boolean`, so publishing fails. Removed
2026-07-29; local dev, `expo export`, and the dev server all resolve fine
without it (verified by fetching an iOS dev bundle from `expo start`).

Keep the root and mobile `convex` package versions aligned.

## Still open

- Testing on a real device (`npx expo run:ios --device`); push needs a dev
  build, not Expo Go.
- `eas init` writes `extra.eas.projectId`, which
  `getExpoPushTokenAsync` wants in a standalone build (see DISTRIBUTION.md).
