"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { NAV } from "./nav";

/**
 * Power-user keys: "g" then a letter to jump (g t = transactions), "/" to
 * search, "n" new transaction, "?" for help. Ignored while typing.
 */
export function Shortcuts() {
  const router = useRouter();
  const pendingG = useRef(0);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (Date.now() - pendingG.current < 1200) {
        const item = NAV.find((n) => n.key === e.key);
        pendingG.current = 0;
        if (item) {
          e.preventDefault();
          router.push(item.href);
        }
        return;
      }
      if (e.key === "g") pendingG.current = Date.now();
      else if (e.key === "/") {
        const search = document.querySelector<HTMLInputElement>("[data-search]");
        if (search) {
          e.preventDefault();
          search.focus();
        } else router.push("/transactions?focus=1");
      } else if (e.key === "n") router.push("/transactions?new=1");
      else if (e.key === "?") setHelp((h) => !h);
      else if (e.key === "Escape") setHelp(false);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [router]);
  if (!help) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setHelp(false)}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 font-semibold">Keyboard shortcuts</h2>
        <ul className="space-y-1.5 text-sm">
          {NAV.map((n) => (
            <li key={n.href} className="flex justify-between">
              <span className="text-muted">{n.label}</span>
              <kbd className="rounded bg-surface-2 px-1.5 text-xs">g {n.key}</kbd>
            </li>
          ))}
          <li className="flex justify-between"><span className="text-muted">Search transactions</span><kbd className="rounded bg-surface-2 px-1.5 text-xs">/</kbd></li>
          <li className="flex justify-between"><span className="text-muted">New transaction</span><kbd className="rounded bg-surface-2 px-1.5 text-xs">n</kbd></li>
          <li className="flex justify-between"><span className="text-muted">Select / bulk edit (in list)</span><kbd className="rounded bg-surface-2 px-1.5 text-xs">x</kbd></li>
        </ul>
      </div>
    </div>
  );
}
