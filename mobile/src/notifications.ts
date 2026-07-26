import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * Device-side push notification plumbing. Tokens produced here get recorded
 * on the backend via api.notifications.registerPushToken; the sends live in
 * convex/notifications.ts.
 */

// Show alerts even when the app is foregrounded — a ⭐️ landing while you're
// reading the feed should still be felt.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

async function expoPushToken(): Promise<string> {
  const projectId: string | undefined =
    Constants.expoConfig?.extra?.eas?.projectId;
  const token = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );
  return token.data;
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Push Up Club",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }
}

/**
 * Ask for permission (prompting if needed) and return the Expo push token,
 * or null if declined / unsupported (simulators have no push service).
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    return null;
  }
  await ensureAndroidChannel();
  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== "granted") {
    return null;
  }
  return await expoPushToken();
}

/**
 * Same, but never prompts: returns a fresh token only when permission was
 * already granted. Called on every sign-in so a reinstalled app or rotated
 * token quietly heals itself.
 */
export async function currentPushTokenIfPermitted(): Promise<string | null> {
  if (!Device.isDevice) {
    return null;
  }
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") {
    return null;
  }
  await ensureAndroidChannel();
  return await expoPushToken();
}
