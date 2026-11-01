"use client";
import { Printer } from "lucide-react";
import { buttonClass } from "@/components/ui";

/** "Save as PDF" via the browser's print dialog — print CSS hides the chrome. */
export function PrintButton() {
  return (
    <button className={buttonClass("secondary", "sm")} onClick={() => window.print()}>
      <Printer size={14} /> PDF
    </button>
  );
}
