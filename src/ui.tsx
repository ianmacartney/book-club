import type { ReactNode } from "react";

export function Card(props: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`surface-card ${props.className ?? ""}`}
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
    ghost: "border border-control hover:bg-paper",
    danger: "border border-red-300 text-red-700 hover:bg-red-50",
  };
  return (
    <button
      type={props.type ?? "button"}
      onClick={props.onClick}
      disabled={props.disabled}
      className={`button-control ${variants[props.variant ?? "primary"]} ${props.className ?? ""}`}
    >
      {props.children}
    </button>
  );
}

export function Field(props: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-sm font-semibold">
        {props.label}
      </span>
      {props.children}
    </label>
  );
}

export const inputClass = "input-control";

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
      className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${tones[props.tone ?? "muted"]}`}
    >
      {props.children}
    </span>
  );
}

export function NavIcon(props: {
  name: "today" | "book" | "library" | "standings" | "club";
}) {
  const paths = {
    today: (
      <path d="m12 3 2.7 5.6 6.2.9-4.5 4.4 1.1 6.1-5.5-2.9L6.5 20l1.1-6.1L3.1 9.5l6.2-.9L12 3Z" />
    ),
    book: (
      <path d="M12 5v15M3 4h4a7 7 0 0 1 5 2 7 7 0 0 1 5-2h4v14h-4a7 7 0 0 0-5 2 7 7 0 0 0-5-2H3V4Z" />
    ),
    library: (
      <path d="M4 5h4v15H4zM8 5h4v15H8zM14 5l4-1 4 15-4 1zM4 8h8M4 17h8" />
    ),
    standings: (
      <path d="M7 16H6a4 4 0 0 1-.5-8 6 6 0 0 1 11.6-1.5A4.8 4.8 0 0 1 18 16h-1M13 12l-3 5h4l-3 5" />
    ),
    club: (
      <>
        <circle cx="9" cy="7" r="3" />
        <path d="M3 20v-2a6 6 0 0 1 12 0v2M16 4a3 3 0 0 1 0 6M18 13a5 5 0 0 1 3 5v2" />
      </>
    ),
  };
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {paths[props.name]}
    </svg>
  );
}
