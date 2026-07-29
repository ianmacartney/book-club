import { Ionicons } from "@expo/vector-icons";
import * as Updates from "expo-updates";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, space } from "./theme";

/**
 * "Update ready → Restart" banner for OTA updates (EAS Update).
 *
 * Without this, a published update boots from the bundle the app already has,
 * downloads the new one in the background, and only swaps it in on the *next*
 * cold start — so the club sees a change on their second open, not their first.
 * This surfaces the downloaded update immediately and lets them apply it with a
 * tap, rather than restarting the app out from under someone mid-sentence.
 */

/** Don't re-check on every foreground; the club opens this app a lot. */
const RECHECK_AFTER_MS = 5 * 60 * 1000;

export function UpdateBanner() {
  const { isUpdatePending } = Updates.useUpdates();
  const [dismissed, setDismissed] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const lastCheckedAt = useRef(0);

  // expo-updates only checks at launch, so an app left open for days never
  // notices a publish. Re-check when it returns to the foreground.
  useEffect(() => {
    // False in dev builds and Expo Go, where these APIs reject outright.
    if (!Updates.isEnabled) return;

    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      const now = Date.now();
      if (now - lastCheckedAt.current < RECHECK_AFTER_MS) return;
      lastCheckedAt.current = now;
      void (async () => {
        try {
          const check = await Updates.checkForUpdateAsync();
          if (check.isAvailable) {
            // Downloading flips isUpdatePending, which shows the banner.
            await Updates.fetchUpdateAsync();
          }
        } catch {
          // Offline or mid-deploy — the launch-time check will catch it later.
        }
      })();
    });
    return () => sub.remove();
  }, []);

  // A newly downloaded update supersedes an earlier dismissal.
  useEffect(() => {
    if (isUpdatePending) setDismissed(false);
  }, [isUpdatePending]);

  const restart = useCallback(() => {
    setRestarting(true);
    Updates.reloadAsync().catch(() => setRestarting(false));
  }, []);

  if (!isUpdatePending || dismissed) return null;

  return (
    <View style={styles.banner}>
      <Ionicons name="sparkles" size={14} color={colors.accent} />
      <Text style={styles.label}>New version ready</Text>
      <Pressable
        onPress={restart}
        disabled={restarting}
        style={({ pressed }) => [
          styles.action,
          pressed && { opacity: 0.75 },
          restarting && { opacity: 0.5 },
        ]}
      >
        <Text style={styles.actionText}>
          {restarting ? "Restarting…" : "Restart"}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => setDismissed(true)}
        hitSlop={10}
        accessibilityLabel="Dismiss update"
      >
        <Ionicons name="close" size={16} color={colors.inkFaint} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    marginHorizontal: space(5),
    marginBottom: space(2),
    paddingVertical: space(2),
    paddingHorizontal: space(3),
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
  },
  label: { flex: 1, fontSize: 13, fontWeight: "600", color: colors.accent },
  action: {
    paddingVertical: space(1),
    paddingHorizontal: space(3),
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  actionText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
    color: colors.white,
  },
});
