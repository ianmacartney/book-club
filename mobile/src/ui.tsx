import { ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";
import { initials } from "./lib";
import { colors, radius, serif, shadow, space } from "./theme";

export function Card(props: { children: ReactNode; style?: ViewStyle }) {
  return (
    <View style={[styles.card, shadow.card, props.style]}>
      {props.children}
    </View>
  );
}

export function Heading(props: { children: ReactNode; style?: TextStyle }) {
  return <Text style={[styles.heading, props.style]}>{props.children}</Text>;
}

export function Muted(props: { children: ReactNode; style?: TextStyle }) {
  return <Text style={[styles.muted, props.style]}>{props.children}</Text>;
}

export function Btn(props: {
  children: ReactNode;
  onPress?: () => void;
  variant?: "primary" | "ghost" | "gold" | "storm";
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const variant = props.variant ?? "primary";
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      style={({ pressed }) => [
        styles.btn,
        variantStyles[variant],
        pressed && { opacity: 0.75 },
        props.disabled && { opacity: 0.4 },
        props.style,
      ]}
    >
      <Text
        style={[
          styles.btnText,
          variant === "primary" && { color: colors.white },
          variant === "gold" && { color: colors.ink },
          variant === "storm" && { color: colors.white },
        ]}
      >
        {props.children}
      </Text>
    </Pressable>
  );
}

export function Pill(props: {
  children: ReactNode;
  tone?: "ok" | "warn" | "muted" | "accent";
}) {
  const tones: Record<string, { bg: string; fg: string }> = {
    ok: { bg: colors.greenSoft, fg: colors.green },
    warn: { bg: colors.goldSoft, fg: colors.gold },
    muted: { bg: colors.stormSoft, fg: colors.storm },
    accent: { bg: colors.accentSoft, fg: colors.accent },
  };
  const tone = tones[props.tone ?? "muted"];
  return (
    <View style={[styles.pill, { backgroundColor: tone.bg }]}>
      <Text style={[styles.pillText, { color: tone.fg }]}>
        {props.children}
      </Text>
    </View>
  );
}

/** A small circular monogram, deterministic color per name. */
export function Avatar(props: { name: string; size?: number }) {
  const size = props.size ?? 30;
  const palette = [colors.accent, colors.storm, colors.green, colors.gold];
  const hue =
    palette[
      [...props.name].reduce((n, c) => n + c.charCodeAt(0), 0) % palette.length
    ];
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: hue,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          color: colors.white,
          fontSize: size * 0.4,
          fontWeight: "700",
        }}
      >
        {initials(props.name)}
      </Text>
    </View>
  );
}

/** Centered hairline-with-label, used for day breaks and milestones. */
export function Rule(props: { label: string }) {
  return (
    <View style={styles.rule}>
      <View style={styles.ruleLine} />
      <Text style={styles.ruleLabel}>{props.label}</Text>
      <View style={styles.ruleLine} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: space(4),
  },
  heading: {
    fontFamily: serif,
    fontSize: 19,
    color: colors.ink,
    marginBottom: space(1),
  },
  muted: {
    fontSize: 13,
    color: colors.inkSoft,
    lineHeight: 18,
  },
  btn: {
    borderRadius: radius.md,
    paddingVertical: space(2.5),
    paddingHorizontal: space(4),
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.ink,
  },
  pill: {
    borderRadius: radius.full,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1),
    alignSelf: "flex-start",
  },
  pillText: {
    fontSize: 12,
    fontWeight: "700",
  },
  rule: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(3),
    marginVertical: space(3),
  },
  ruleLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.inkFaint,
  },
  ruleLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.inkFaint,
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },
});

const variantStyles: Record<string, ViewStyle> = {
  primary: { backgroundColor: colors.accent },
  ghost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: colors.line,
  },
  gold: { backgroundColor: colors.goldSoft },
  storm: { backgroundColor: colors.storm },
};
