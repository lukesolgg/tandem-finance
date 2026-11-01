import type { ParseWarning } from "./types";

/**
 * Credit-card sign conventions.
 *
 * Card exports disagree on sign: some print spend as negative (bank-style),
 * others print spend as POSITIVE because it increases what you owe (Amex,
 * many card PDFs). Payments to the card are the tell — they're always money
 * IN from the card's point of view. So:
 *   1. If payment-looking rows exist, their sign decides the convention.
 *   2. Otherwise the majority sign is spend (cards are mostly purchases).
 */
export const CARD_PAYMENT_RE =
  /\b(?:payment\s+(?:received|thank\s*you|-\s*thank)|thank\s*you|direct\s+debit\s+(?:payment|received)|dd\s+payment|payment\s+by\s+(?:dd|direct debit)|card\s+payment\s+received|faster\s+payment\s+received|refund|credit\s+adjustment)\b/i;

export function looksLikeCardPayment(description: string): boolean {
  return CARD_PAYMENT_RE.test(description);
}

/**
 * Decide whether a card's single amount column needs inverting.
 * `rows` carry signed amounts as printed.
 */
export function cardNeedsInversion(rows: { amount: number; description: string }[]): { invert: boolean; warning?: ParseWarning } {
  const payments = rows.filter((r) => looksLikeCardPayment(r.description) && r.amount !== 0);
  if (payments.length > 0) {
    const negPayments = payments.filter((r) => r.amount < 0).length;
    // Payments printed negative ⇒ spend printed positive ⇒ invert.
    return { invert: negPayments > payments.length / 2 };
  }
  const nonZero = rows.filter((r) => r.amount !== 0);
  const positive = nonZero.filter((r) => r.amount > 0).length;
  if (nonZero.length && positive / nonZero.length > 0.6) return { invert: true, warning: "sign_convention_inferred" };
  return { invert: false };
}
