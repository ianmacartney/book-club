import type { ReactNode } from "react";

export function Card(props: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-ink/10 bg-white p-5 shadow-sm ${props.className ?? ""}`}
    >
      {props.children}
    </div>
  );
}

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  className?: string;
}) {
  const variants = {
    primary: "bg-accent text-white hover:bg-accent-dark",
    ghost: "border border-ink/20 hover:bg-ink/5",
    danger: "border border-red-300 text-red-700 hover:bg-red-50",
  };
  return (
    <button
      type={props.type ?? "button"}
      onClick={props.onClick}
      disabled={props.disabled}
      className={`rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${variants[props.variant ?? "primary"]} ${props.className ?? ""}`}
    >
      {props.children}
    </button>
  );
}

export function Field(props: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/60">
        {props.label}
      </span>
      {props.children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

export function ErrorNote(props: { error: string | null }) {
  if (!props.error) return null;
  return (
    <p role="alert" className="mt-2 text-sm font-medium text-red-700">
      {props.error}
    </p>
  );
}

export function Pill(props: { children: ReactNode; tone?: "ok" | "warn" | "muted" }) {
  const tones = {
    ok: "bg-emerald-100 text-emerald-800",
    warn: "bg-amber-100 text-amber-900",
    muted: "bg-ink/10 text-ink/70",
  };
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[props.tone ?? "muted"]}`}
    >
      {props.children}
    </span>
  );
}
