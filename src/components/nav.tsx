"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Activity, ArrowLeftRight, CalendarCheck, Home, Landmark, Menu, Plus, Settings, Target, Upload, Wallet, X,
} from "lucide-react";
import { cx } from "./ui";

export const NAV = [
  { href: "/", label: "Home", icon: Home, key: "h" },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight, key: "t" },
  { href: "/budgets", label: "Budgets", icon: Wallet, key: "b" },
  { href: "/goals", label: "Goals", icon: Target, key: "g" },
  { href: "/import", label: "Import", icon: Upload, key: "i" },
  { href: "/review", label: "Monthly review", icon: CalendarCheck, key: "r" },
  { href: "/accounts", label: "Accounts", icon: Landmark, key: "a" },
  { href: "/activity", label: "Activity", icon: Activity, key: "l" },
  { href: "/settings", label: "Settings", icon: Settings, key: "s" },
] as const;

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
}

export function Sidebar({ footer }: { footer: React.ReactNode }) {
  const path = usePathname();
  return (
    <aside className="no-print sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-4 lg:flex">
      <Link href="/" className="mb-6 flex items-center gap-2.5 px-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" width={26} height={26} />
        <span className="font-semibold tracking-tight">Tandem</span>
      </Link>
      <nav className="flex-1 space-y-0.5">
        {NAV.map(({ href, label, icon: Icon, key }) => (
          <Link
            key={href}
            href={href}
            className={cx(
              "group flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm",
              isActive(path, href) ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-2 hover:text-text",
            )}
          >
            <Icon size={17} strokeWidth={1.8} />
            <span className="flex-1">{label}</span>
            <kbd className="hidden text-[10px] text-muted/60 group-hover:inline">g {key}</kbd>
          </Link>
        ))}
      </nav>
      {footer}
    </aside>
  );
}

const TABS = [NAV[0], NAV[1], NAV[4], NAV[2]] as const;

export function MobileNav({ footer }: { footer: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);
  useEffect(() => setOpen(false), [path]);
  return (
    <>
      <nav className="no-print pb-safe fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface/95 backdrop-blur lg:hidden">
        {TABS.map(({ href, label, icon: Icon }) =>
          href === "/import" ? (
            <Link key={href} href={href} className="flex flex-col items-center justify-center py-1.5" aria-label="Import statement">
              <span className="grid size-10 place-items-center rounded-full bg-accent text-white shadow">
                <Plus size={20} />
              </span>
            </Link>
          ) : (
            <Link key={href} href={href} className={cx("flex flex-col items-center gap-0.5 pt-2 text-[11px]", isActive(path, href) ? "text-accent" : "text-muted")}>
              <Icon size={20} strokeWidth={1.8} />
              {label}
            </Link>
          ),
        )}
        <button onClick={() => setOpen(true)} className="flex flex-col items-center gap-0.5 pt-2 text-[11px] text-muted">
          <Menu size={20} strokeWidth={1.8} />
          More
        </button>
      </nav>
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === ref.current && setOpen(false)}
        className="m-0 mt-auto w-full max-w-none rounded-t-3xl border-0 bg-surface p-0 text-text lg:hidden"
      >
        <div className="pb-safe px-4 pt-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">More</span>
            <button onClick={() => setOpen(false)} className="grid size-8 place-items-center rounded-full bg-surface-2" aria-label="Close">
              <X size={16} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 pb-3">
            {[NAV[3], NAV[5], NAV[6], NAV[7], NAV[8]].map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className="flex flex-col items-center gap-1.5 rounded-2xl bg-surface-2 py-4 text-xs">
                <Icon size={20} strokeWidth={1.8} />
                {label}
              </Link>
            ))}
          </div>
          {footer}
        </div>
      </dialog>
    </>
  );
}
