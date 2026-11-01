import type { LearnedMerchant } from "./engine";

/**
 * Learning from corrections.
 *
 * The household shares ONE merchant→category memory, so when either partner
 * fixes "Spar → Groceries", both benefit next upload. Corrections are
 * recorded per merchant with two counters:
 *   confirmations — user kept / chose this category
 *   overrides     — user changed AWAY from the learned category
 * A single change of mind flips the learned category immediately (the latest
 * explicit choice wins) but resets confidence, so the UI shows it as a
 * suggestion again until it's been confirmed.
 *
 * After the same merchant is corrected to the same category twice, we offer
 * a one-tap "Always categorise X as Y" rule — explicit beats implicit.
 */
export interface CorrectionResult {
  next: LearnedMerchant;
  /** Show the "make this a rule?" prompt. */
  suggestRule: boolean;
}

export const SUGGEST_RULE_AFTER = 2;

export function applyCorrection(current: LearnedMerchant | undefined, merchantKey: string, chosenCategoryKey: string): CorrectionResult {
  if (!current) {
    return { next: { key: merchantKey, categoryKey: chosenCategoryKey, confirmations: 1, overrides: 0 }, suggestRule: false };
  }
  if (current.categoryKey === chosenCategoryKey) {
    const next = { ...current, confirmations: current.confirmations + 1 };
    return { next, suggestRule: next.confirmations === SUGGEST_RULE_AFTER };
  }
  // Changed their mind: adopt the new choice, remember the disagreement.
  return {
    next: { key: merchantKey, categoryKey: chosenCategoryKey, confirmations: 1, overrides: current.overrides + 1 },
    suggestRule: false,
  };
}

/** Accepting an auto-categorised txn without editing it is a (weak) confirmation. */
export function applyImplicitConfirmation(current: LearnedMerchant): LearnedMerchant {
  return { ...current, confirmations: current.confirmations + 1 };
}
