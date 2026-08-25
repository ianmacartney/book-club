import {
  useSignInWithPassword,
  useSignUpWithPassword,
} from "@convex-dev/auth/providers/password/react";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api } from "../../../convex/_generated/api";
import { colors, radius, serif, space } from "../theme";
import { Btn, Muted } from "../ui";

export function AuthScreen() {
  const [mode, setMode] = useState<"logIn" | "signUp">("logIn");
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.root}
    >
      <Text style={styles.title}>Push Up Club</Text>
      <Muted style={styles.tagline}>
        Pushups every day. A book on the go.{"\n"}⭐️ or ⛈️ — your call.
      </Muted>
      {mode === "logIn" ? <LogInForm /> : <SignUpForm />}
      <Pressable onPress={() => setMode(mode === "logIn" ? "signUp" : "logIn")}>
        <Text style={styles.switchLine}>
          {mode === "logIn" ? (
            <>
              New here? <Text style={styles.switchLink}>Create an account</Text>
            </>
          ) : (
            <>
              Already a member? <Text style={styles.switchLink}>Log in</Text>
            </>
          )}
        </Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

function LogInForm() {
  const { signIn, pending } = useSignInWithPassword(
    api.auth.signInWithPassword,
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const result = await signIn({ username: username.trim(), password });
    if (result.success) {
      return;
    }
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
  };

  return (
    <CredentialsForm
      cta={pending ? "Logging in…" : "Log in"}
      username={username}
      password={password}
      onUsername={setUsername}
      onPassword={setPassword}
      error={error}
      pending={pending}
      onSubmit={() => void submit()}
      newPassword={false}
    />
  );
}

function SignUpForm() {
  const { signUp, pending } = useSignUpWithPassword(
    api.auth.signUpWithPassword,
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const result = await signUp({ username: username.trim(), password });
    if (result.success) {
      return;
    }
    setError(() => {
      switch (result.userError.error) {
        case "USERNAME_TAKEN":
          return "That username is already taken.";
        case "USERNAME_TOO_SHORT":
          return `Username must be at least ${result.userError.minimumLength} character(s).`;
        case "USERNAME_HAS_SURROUNDING_WHITESPACE":
          return "Username can't start or end with whitespace.";
        case "USERNAME_HAS_INVALID_CHARACTERS":
          return "Username contains characters that aren't allowed.";
        case "PASSWORD_TOO_SHORT":
          return `Password must be at least ${result.userError.minimumLength} characters.`;
        case "PASSWORD_TOO_LONG":
          return `Password must be at most ${result.userError.maximumLength} characters.`;
        case "PASSWORD_HAS_SURROUNDING_WHITESPACE":
          return "Password can't start or end with whitespace.";
        case "PASSWORD_TOO_COMMON":
          return "Password is too common. Please choose a stronger password.";
        case "OTHER_ERROR":
          console.error("Sign-up failed:", result.userError.cause);
          return "Something went wrong. Please try again.";
        default:
          result.userError satisfies never;
          return "Unknown error.";
      }
    });
  };

  return (
    <CredentialsForm
      cta={pending ? "Creating account…" : "Create account"}
      username={username}
      password={password}
      onUsername={setUsername}
      onPassword={setPassword}
      error={error}
      pending={pending}
      onSubmit={() => void submit()}
      newPassword
    />
  );
}

function CredentialsForm(props: {
  cta: string;
  username: string;
  password: string;
  onUsername: (v: string) => void;
  onPassword: (v: string) => void;
  error: string | null;
  pending: boolean;
  onSubmit: () => void;
  newPassword: boolean;
}) {
  return (
    <View style={styles.form}>
      <TextInput
        style={styles.input}
        placeholder="Username"
        placeholderTextColor={colors.inkFaint}
        value={props.username}
        onChangeText={props.onUsername}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        editable={!props.pending}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor={colors.inkFaint}
        value={props.password}
        onChangeText={props.onPassword}
        secureTextEntry
        autoComplete={props.newPassword ? "new-password" : "current-password"}
        editable={!props.pending}
        onSubmitEditing={props.onSubmit}
      />
      {props.error !== null && <Text style={styles.error}>{props.error}</Text>}
      <Btn
        onPress={props.onSubmit}
        disabled={
          props.pending ||
          props.username.trim().length === 0 ||
          props.password.length === 0
        }
        style={styles.cta}
      >
        {props.cta}
      </Btn>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.paper,
    justifyContent: "center",
    padding: space(8),
    gap: space(4),
  },
  title: {
    fontFamily: serif,
    fontSize: 34,
    color: colors.ink,
    textAlign: "center",
  },
  tagline: { textAlign: "center", marginBottom: space(4) },
  form: { gap: space(3) },
  input: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingVertical: space(2.5),
    fontSize: 17,
    color: colors.ink,
  },
  error: { color: colors.accent, fontSize: 13, fontWeight: "600" },
  cta: { marginTop: space(2), borderRadius: radius.md },
  switchLine: {
    textAlign: "center",
    color: colors.inkSoft,
    fontSize: 14,
    paddingVertical: space(2),
  },
  switchLink: { color: colors.accent, fontWeight: "700" },
});
