import type { TokenStorage } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

function convexUrl(): string {
  const url = Constants.expoConfig?.extra?.convexUrl;
  if (typeof url !== "string") {
    throw new Error("Set expo.extra.convexUrl in app.json");
  }
  return url;
}

export const convex = new ConvexReactClient(convexUrl());

/**
 * Auth tokens live in the device keychain. Convex Auth namespaces its keys
 * with the deployment URL stripped to alphanumerics, which satisfies
 * SecureStore's key charset.
 */
export const secureStorage: TokenStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

export function deviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
