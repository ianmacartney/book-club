import { components, internal } from "./_generated/api";
import { setupCore } from "@convex-dev/auth/core/setup";
import { setupUsernamePassword } from "@convex-dev/auth/providers/password/setup";

// The access token's lifetime sets how often every open client rotates its
// refresh token, because the client refreshes as the access token runs out.
// At the 60s default that was a rotation a minute per device — measured at a
// 51s median — and each rotation is a chance for the client to fail to persist
// the token it was handed (killed mid-flight, backgrounded, dropped response).
// When that happens the server has already moved on and the old token is only
// honoured for 30s, so the member is silently signed out. An hour keeps the
// same mechanism with ~60x fewer chances to lose the race.
const core = setupCore({
  component: components.core,
  accessTokenTtlSeconds: 60 * 60,
});
export const { signOut, refreshSession, isAuthenticated } = core;

export const { signUpWithPassword, signInWithPassword } = setupUsernamePassword(
  core,
  {
    component: components.authPasswordProvider,
    usernameComponent: components.authUsername,
  },
).attachUserCallbacks({ createUser: internal.users.createUser });
