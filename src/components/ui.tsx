import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";

/**
 * Small, dependency-free UI kit in the shadcn spirit: plain elements +
 * Tailwind, theme via CSS variables (see globals.css). Server-component safe.
 */
export const cx = clsx;

type BtnVariant = "primary" | "secondary" | "ghost" | "danger";
export function buttonClass(variant: BtnVariant = "secondary", size: "sm" | "md" = "md") {
  return cx(
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none select-none whitespace-nowrap",
    size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-10 px-3.5 text-sm",
    variant === "primary" && "bg-accent text-white hover:opacity-90 shadow-sm",
    variant === "secondary" && "bg-surface border border-border hover:bg-surface-2",
    variant === "ghost" && "hover:bg-surface-2 text-muted hover:text-text",
    variant === "danger" && "bg-surface border border-border text-neg hover:bg-neg/10",
  );
}

export function Button({ variant, size, className, ...p }: ComponentProps<"button"> & { variant?: BtnVariant; size?: "sm" | "md" }) {
  return <button className={cx(buttonClass(variant, size), className)} {...p} />;
}

export const inputClass =
  "h-10 w-full rounded-lg border border-border bg-surface px-3 text-[15px] sm:text-sm placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--ring)]";

export function Input({ className, ...p }: ComponentProps<"input">) {
  return <input className={cx(inputClass, className)} {...p} />;
}

export function Select({ className, ...p }: ComponentProps<"select">) {
  return <select className={cx(inputClass, "pr-8 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 fill=%22none%22 stroke=%22%23888%22 stroke-width=%222%22><path d=%22M3 4.5l3 3 3-3%22/></svg>')] bg-no-repeat bg-[right_0.7rem_center]", className)} {...p} />;
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block space-y-1.5", className)}>
      <span className="text-[13px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Card({ className, children, ...p }: ComponentProps<"div">) {
  return (
    <div className={cx("rounded-2xl border border-border bg-surface", className)} {...p}>
      {children}
    </div>
  );
}

export function CardHeader({ title, action, subtitle }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-5">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "accent" | "pos" | "neg" | "warn"; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        tone === "neutral" && "bg-surface-2 text-muted",
        tone === "accent" && "bg-accent-soft text-accent",
        tone === "pos" && "bg-pos/10 text-pos",
        tone === "neg" && "bg-neg/10 text-neg",
        tone === "warn" && "bg-warn/10 text-warn",
        className,
      )}
    >
      {children}
    </span>
  );
}

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const gbp0 = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });

export function formatMoney(minor: number, opts: { whole?: boolean; sign?: boolean } = {}) {
  const s = (opts.whole ? gbp0 : gbp).format(Math.abs(minor) / 100);
  if (minor < 0) return `−${s}`;
  return opts.sign && minor > 0 ? `+${s}` : s;
}

/** Money: credits green with "+", debits plain (spending is normal, not an error). */
export function Money({ minor, className, whole, colour = true }: { minor: number; className?: string; whole?: boolean; colour?: boolean }) {
  return (
    <span className={cx("tabular whitespace-nowrap", colour && minor > 0 && "text-pos", className)}>
      {formatMoney(minor, { whole, sign: colour })}
    </span>
  );
}

export function Progress({ value, tone = "accent", className, marker }: { value: number; tone?: "accent" | "pos" | "neg" | "warn"; className?: string; marker?: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={cx("relative h-2 overflow-hidden rounded-full bg-surface-2", className)}>
      <div
        className={cx(
          "h-full rounded-full transition-[width] duration-500",
          tone === "accent" && "bg-accent",
          tone === "pos" && "bg-pos",
          tone === "neg" && "bg-neg",
          tone === "warn" && "bg-warn",
        )}
        style={{ width: `${pct}%` }}
      />
      {marker !== undefined && <div className="absolute top-0 h-full w-0.5 bg-text/30" style={{ left: `${Math.min(1, marker) * 100}%` }} title="Today" />}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">{icon}</div>}
      <h3 className="font-semibold">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Avatar({ name, colour, size = 22 }: { name: string; colour: string; size?: number }) {
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{ background: colour, width: size, height: size, fontSize: size * 0.45 }}
      aria-label={name}
      title={name}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function ErrorText({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p className="rounded-lg bg-neg/10 px-3 py-2 text-sm text-neg">{children}</p>;
}
