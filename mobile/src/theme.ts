import { Platform } from "react-native";

/**
 * The design language: a well-worn reading room. Warm parchment ground,
 * near-black ink, one oxblood accent, gold for stars and slate for storms.
 * Serif display for anything book-ish, the system sans for chrome.
 */
export const colors = {
  paper: "#F4EFE5",
  card: "#FFFDF7",
  ink: "#231D17",
  inkSoft: "rgba(35,29,23,0.58)",
  inkFaint: "rgba(35,29,23,0.34)",
  line: "rgba(35,29,23,0.10)",
  accent: "#8A3B2A",
  accentSoft: "rgba(138,59,42,0.10)",
  gold: "#A87B1F",
  goldSoft: "rgba(168,123,31,0.14)",
  storm: "#57616E",
  stormSoft: "rgba(87,97,110,0.13)",
  green: "#3F6B52",
  greenSoft: "rgba(63,107,82,0.13)",
  white: "#FFFFFF",
};

export const serif = Platform.select({
  ios: "Georgia",
  android: "serif",
  default: "Georgia",
});

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  full: 999,
};

export const space = (n: number) => n * 4;

export const shadow = {
  card: {
    shadowColor: colors.ink,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
};
