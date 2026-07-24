import {
  useSignInWithPassword,
  useSignUpWithPassword,
} from "@convex-dev/auth/providers/password/react";
import { useState } from "react";
import { api } from "../convex/_generated/api";
import { Button, Card, ErrorNote, Field, inputClass } from "./ui";

export function AuthScreen() {
  const [mode, setMode] = useState<"logIn" | "signUp">("logIn");
  return (
    <div className="mx-auto max-w-sm pt-16">
      <h1 className="mb-1 text-center text-3xl font-bold">📚 Book Club</h1>
      <p className="mb-8 text-center text-ink/60">
        Pushups every day. A book on the go. ⭐️ or ⛈️ — your call.
      </p>
      <Card>
        {mode === "logIn" ? <LogInForm /> : <SignUpForm />}
        <p className="mt-4 text-center text-sm text-ink/60">
          {mode === "logIn" ? (
            <>
              New here?{" "}
              <button
                className="font-semibold text-accent hover:underline"
                onClick={() => setMode("signUp")}
              >
                Create an account
              </button>
            </>
          ) : (
            <>
              Already a member?{" "}
              <button
                className="font-semibold text-accent hover:underline"
                onClick={() => setMode("logIn")}
              >
                Log in
              </button>
            </>
          )}
        </p>
      </Card>
    </div>
  );
}

function LogInForm() {
  const { signIn, pending } = useSignInWithPassword(api.auth.signInWithPassword);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const result = await signIn({ username, password });
        if (result.success) return;
        setError(() => {
          switch (result.userError.error) {
            case "USER_NOT_FOUND":
              return "No account exists with that username.";
            case "INVALID_CREDENTIALS":
              return "Incorrect username or password.";
            case "PASSWORD_TOO_SHORT":
              return `Password must be at least ${result.userError.minimumLength} characters.`;
            case "PASSWORD_TOO_LONG":
              return `Password must be at most ${result.userError.maximumLength} characters.`;
            case "PASSWORD_HAS_SURROUNDING_WHITESPACE":
              return "Password can't start or end with whitespace.";
            case "RATE_LIMITED":
              return `Too many attempts. Try again in ${Math.ceil(result.userError.retryAfterMs / 1000)} seconds.`;
            case "OTHER_ERROR":
              console.error("Sign-in failed:", result.userError.cause);
              return "Something went wrong. Please try again.";
            default:
              result.userError satisfies never;
              return "Unknown error.";
          }
        });
      }}
    >
      <h2 className="text-lg font-bold">Log in</h2>
      <Field label="Username">
        <input
          className={inputClass}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
          disabled={pending}
        />
      </Field>
      <Field label="Password">
        <input
          className={inputClass}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          disabled={pending}
        />
      </Field>
      <ErrorNote error={error} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Logging in…" : "Log in"}
      </Button>
    </form>
  );
}

function SignUpForm() {
  const { signUp, pending } = useSignUpWithPassword(api.auth.signUpWithPassword);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const result = await signUp({ username, password });
        if (result.success) return;
        setError(() => {
          switch (result.userError.error) {
            case "USERNAME_TAKEN":
              return "That username is already taken.";
            case "PASSWORD_TOO_SHORT":
              return `Password must be at least ${result.userError.minimumLength} characters.`;
            case "PASSWORD_TOO_LONG":
              return `Password must be at most ${result.userError.maximumLength} characters.`;
            case "PASSWORD_HAS_SURROUNDING_WHITESPACE":
              return "Password can't start or end with whitespace.";
            case "OTHER_ERROR":
              console.error("Sign-up failed:", result.userError.cause);
              return "Something went wrong. Please try again.";
            default:
              result.userError satisfies never;
              return "Unknown error.";
          }
        });
      }}
    >
      <h2 className="text-lg font-bold">Create your account</h2>
      <Field label="Username">
        <input
          className={inputClass}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
          disabled={pending}
        />
      </Field>
      <Field label="Password">
        <input
          className={inputClass}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
          disabled={pending}
        />
      </Field>
      <ErrorNote error={error} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creating account…" : "Sign up"}
      </Button>
    </form>
  );
}
