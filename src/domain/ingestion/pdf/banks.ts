import type { BankId } from "../types";

/**
 * Bank fingerprints & per-bank tweaks for the generic PDF table parser.
 *
 * The generic parser gets most UK layouts right on its own. Tweaks exist only
 * where a bank does something the heuristics can't infer — keep them minimal
 * and back each with a fixture test so we notice when a template changes.
 */
const MARKERS: [RegExp, BankId][] = [
  [/monzo bank limited/i, "monzo"],
  [/starling bank/i, "starling"],
  [/revolut/i, "revolut"],
  [/first direct/i, "first_direct"],
  [/hsbc uk bank/i, "hsbc"],
  [/barclays bank uk/i, "barclays"],
  [/ulster bank/i, "ulster"],
  [/natwest|national westminster/i, "natwest"],
  [/santander uk/i, "santander"],
  [/royal bank of scotland/i, "rbs"],
  [/lloyds bank/i, "lloyds"],
  [/halifax/i, "halifax"],
  [/nationwide building society/i, "nationwide"],
  [/bank of ireland/i, "bank_of_ireland"],
  [/allied irish|\baib\b/i, "aib"],
  [/american express/i, "amex"],
  [/vanquis bank/i, "vanquis"],
  [/capital one/i, "capital_one"],
  [/\bzable\b|lendable/i, "zable"],
];

export function detectPdfBank(text: string): BankId {
  // Check the first ~3k chars: the letterhead. Avoids matching a payee called "Monzo".
  const head = text.slice(0, 3000);
  return MARKERS.find(([re]) => re.test(head))?.[1] ?? "generic";
}

export interface PdfBankTweaks {
  /** Force multi-line assembly mode when heuristics would guess wrong. */
  mode?: "leads" | "terminates";
  /** Extra lines to ignore inside the table area. */
  skip?: RegExp[];
}

export const PDF_BANK_TWEAKS: Partial<Record<BankId, PdfBankTweaks>> = {
  // HSBC / First Direct print the payment-type code (")))", "VIS", "DD") in its own
  // column and wrap long payee names *before* the amount line.
  hsbc: { mode: "terminates" },
  first_direct: { mode: "terminates" },
  // Monzo puts the amount on the payee line; extra lines are reference/notes.
  monzo: { mode: "leads", skip: [/^monzo bank limited/i, /^fscs/i] },
  starling: { mode: "leads" },
  barclays: { skip: [/^barclays bank uk plc/i, /^continued$/i] },
};
