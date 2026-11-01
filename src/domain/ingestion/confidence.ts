import type { ParseWarning, ParsedRow } from "./types";

/**
 * Confidence scoring.
 *
 * Per-row: start at 1 and subtract a penalty per warning. Penalties are tuned so
 * that "one soft warning" still reads as fine (≥0.9) while anything touching
 * the AMOUNT or SIGN drops a row into the "please check" band (<0.8).
 *
 * Statement-level: if the balances reconcile, the numbers are provably right and
 * we cap the downside — residual uncertainty is only in descriptions/dates.
 */
const PENALTY: Record<ParseWarning, number> = {
  date_order_ambiguous: 0.05,
  year_inferred: 0.03,
  multiline_merged: 0.02,
  sign_inferred_from_balance: 0.05, // balance-proven, so mild
  sign_assumed: 0.35,
  sign_convention_inferred: 0.05,
  balance_mismatch: 0.4,
  zero_amount: 0.1,
  unrecognised_layout: 0.1,
  pending_or_reverted_skipped: 0,
  possible_duplicate: 0.25,
};

export const REVIEW_THRESHOLD = 0.8;

export function rowConfidence(warnings: ParseWarning[], base = 1): number {
  const c = warnings.reduce((acc, w) => acc - PENALTY[w], base);
  return Math.max(0, Math.min(1, Math.round(c * 100) / 100));
}

export function statementConfidence(rows: ParsedRow[], reconciled: boolean | null, statementWarnings: ParseWarning[]): number {
  if (rows.length === 0) return 0;
  const mean = rows.reduce((s, r) => s + r.confidence, 0) / rows.length;
  const worst = Math.min(...rows.map((r) => r.confidence));
  // Mean hides one terrible row; blend in the worst so it can't.
  let c = 0.75 * mean + 0.25 * worst;
  if (reconciled === true) c = Math.max(c, 0.95);
  if (reconciled === false) c = Math.min(c, 0.7);
  for (const w of statementWarnings) c -= PENALTY[w];
  return Math.max(0, Math.min(1, Math.round(c * 100) / 100));
}

/** Recompute every row's confidence from its warnings (call after all warnings are attached). */
export function scoreRows(rows: ParsedRow[], base = 1): void {
  for (const r of rows) r.confidence = rowConfidence(r.warnings, base);
}
