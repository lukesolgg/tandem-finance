"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { cx } from "./ui";

/** Bottom sheet on mobile, centred dialog on desktop. Native <dialog> = focus trap + Esc for free. */
export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        "m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-3xl border border-border bg-surface p-0 text-text shadow-2xl",
        "sm:m-auto sm:rounded-2xl",
        wide ? "sm:max-w-2xl" : "sm:max-w-md",
      )}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-5 py-3.5">
        <h2 className="font-semibold">{title}</h2>
        <button onClick={onClose} className="grid size-8 place-items-center rounded-full bg-surface-2" aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <div className="pb-safe px-5 py-4">{open && children}</div>
    </dialog>
  );
}
