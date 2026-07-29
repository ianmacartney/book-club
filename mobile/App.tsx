import { Ionicons } from "@expo/vector-icons";
import {
  Authenticated,
  AuthLoading,
  ConvexAuthProvider,
  Unauthenticated,
} from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { api } from "../convex/_generated/api";
import { convex, deviceTimezone, secureStorage } from "./src/convex";
import { ClubProvider } from "./src/data";
import { currentPushTokenIfPermitted } from "./src/notifications";
import { AuthScreen } from "./src/screens/AuthScreen";
import { BookScreen } from "./src/screens/BookScreen";
import { ClubScreen } from "./src/screens/ClubScreen";
import { FeedScreen } from "./src/screens/FeedScreen";
import { JoinClubScreen } from "./src/screens/JoinClubScreen";
import { LibraryScreen } from "./src/screens/LibraryScreen";
import { colors, serif, space } from "./src/theme";
import { UpdateBanner } from "./src/updates";

export default function App() {
  return (
    <SafeAreaProvider>
      <ConvexAuthProvider
        client={convex}
        api={{
          refreshSession: api.auth.refreshSession,
          signOut: api.auth.signOut,
        }}
        storage={secureStorage}
      >
        <AuthLoading>
          <Splash />
        </AuthLoading>
        <Unauthenticated>
          <AuthScreen />
        </Unauthenticated>
        <Authenticated>
          <SignedIn />
        </Authenticated>
      </ConvexAuthProvider>
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}

function Splash() {
  return (
    <View style={styles.splash}>
      <Text style={styles.splashText}>Opening the club…</Text>
    </View>
  );
}

function SignedIn() {
  const me = useQuery(api.users.me);
  const clubs = useQuery(api.clubs.mine);
  const ensureTimezone = useMutation(api.users.ensureTimezone);
  const registerPushToken = useMutation(api.notifications.registerPushToken);

  // Deadlines live and die by the member's timezone; capture it right away.
  useEffect(() => {
    if (me && me.timezone === null) {
      void ensureTimezone({ timezone: deviceTimezone() });
    }
  }, [me, ensureTimezone]);

  // Keep the push token fresh (reinstalls rotate it). Never prompts here —
  // the explicit ask lives in Club → Notifications.
  useEffect(() => {
    void currentPushTokenIfPermitted().then((token) => {
      if (token !== null) {
        registerPushToken({ token }).catch(() => {});
      }
    });
  }, [registerPushToken]);

  if (me === undefined || clubs === undefined) {
    return <Splash />;
  }
  if (me === null) {
    return null; // auth state settling
  }
  if (clubs.length === 0) {
    return <JoinClubScreen />;
  }
  const club = clubs[0];
  return (
    <ClubProvider clubId={club._id}>
      <Shell clubName={club.name} />
    </ClubProvider>
  );
}

type Tab = "feed" | "book" | "library" | "club";

const TABS: {
  id: Tab;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    id: "feed",
    label: "Feed",
    icon: "chatbubbles-outline",
    activeIcon: "chatbubbles",
  },
  { id: "book", label: "Book", icon: "book-outline", activeIcon: "book" },
  {
    id: "library",
    label: "Library",
    icon: "library-outline",
    activeIcon: "library",
  },
  {
    id: "club",
    label: "Club",
    icon: "settings-outline",
    activeIcon: "settings",
  },
];

function Shell(props: { clubName: string }) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("feed");

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{props.clubName}</Text>
      </View>

      <UpdateBanner />

      <View style={styles.body}>
        {tab === "feed" && <FeedScreen />}
        {tab === "book" && <BookScreen />}
        {tab === "library" && <LibraryScreen />}
        {tab === "club" && <ClubScreen />}
      </View>

      <View
        style={[styles.tabBar, { paddingBottom: insets.bottom || space(2) }]}
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <Pressable
              key={t.id}
              style={styles.tabItem}
              onPress={() => setTab(t.id)}
            >
              <Ionicons
                name={active ? t.activeIcon : t.icon}
                size={22}
                color={active ? colors.accent : colors.inkFaint}
              />
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  splash: {
    flex: 1,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  splashText: { fontFamily: serif, fontSize: 16, color: colors.inkSoft },
  header: {
    paddingHorizontal: space(5),
    paddingVertical: space(3),
  },
  headerTitle: { fontFamily: serif, fontSize: 24, color: colors.ink },
  body: { flex: 1 },
  tabBar: {
    flexDirection: "row",
    backgroundColor: colors.paper,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    paddingTop: space(2),
  },
  tabItem: { flex: 1, alignItems: "center", gap: 3 },
  tabLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.4,
    color: colors.inkFaint,
  },
  tabLabelActive: { color: colors.accent },
});
