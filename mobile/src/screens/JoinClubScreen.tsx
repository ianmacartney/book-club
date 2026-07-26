import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
} from "react-native";
import { api } from "../../../convex/_generated/api";
import { errorMessage } from "../data";
import { colors, radius, serif, space } from "../theme";
import { Btn, Muted } from "../ui";

/** Signed in but clubless: clubs are invite-only, so redeem a code. */
export function JoinClubScreen() {
  const { signOut } = useAuthActions();
  const joinWithCode = useMutation(api.clubs.joinWithCode);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const join = async () => {
    setError(null);
    setPending(true);
    try {
      await joinWithCode({ code: code.trim() });
      // clubs.mine updates reactively; App switches to the club view.
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.root}
    >
      <Text style={styles.title}>Welcome 👋</Text>
      <Muted style={styles.centered}>
        Clubs are invite-only. Ask a member for a code and enter it here —
        founding a new club lives on the web app.
      </Muted>
      <TextInput
        style={styles.input}
        placeholder="INVITE CODE"
        placeholderTextColor={colors.inkFaint}
        value={code}
        onChangeText={(v) => setCode(v.toUpperCase())}
        autoCapitalize="characters"
        autoCorrect={false}
        editable={!pending}
        onSubmitEditing={() => void join()}
      />
      {error !== null && <Text style={styles.error}>{error}</Text>}
      <Btn
        onPress={() => void join()}
        disabled={pending || code.trim().length === 0}
        style={styles.cta}
      >
        {pending ? "Joining…" : "Join the club"}
      </Btn>
      <Pressable onPress={() => void signOut()}>
        <Text style={styles.signOut}>Sign out</Text>
      </Pressable>
    </KeyboardAvoidingView>
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
    fontSize: 28,
    color: colors.ink,
    textAlign: "center",
  },
  centered: { textAlign: "center" },
  input: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingVertical: space(2.5),
    fontSize: 22,
    letterSpacing: 4,
    textAlign: "center",
    color: colors.ink,
  },
  error: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  cta: { borderRadius: radius.md },
  signOut: {
    textAlign: "center",
    color: colors.inkSoft,
    fontSize: 14,
    paddingVertical: space(2),
  },
});
