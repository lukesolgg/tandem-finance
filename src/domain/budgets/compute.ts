/**
 * Budget maths — pure.
 *
 * available = allocated + carriedIn
 * remaining = available − spent      (spent is positive for money out, net of refunds)
 *
 * Rollover policies:
 *  "none"      nothing carries
 *  "positive"  unspent carries forward; overspend is forgiven
 *  "both"      envelope style — overspend reduces next month too
 *
 * Carry-in is computed when a period is opened and then SNAPSHOT on the line
 * (BudgetLine.carriedIn) so editing an old transaction doesn't silently change
 * this month's numbers. The UI offers "recalculate carry-over" explicitly.
 */
export type Rollover = "none" | "positive" | "both";

export interface LineInput {
  categoryId: string;
  allocated: number;
  carriedIn: number;
  spent: number;
}

export interface LineStatus extends LineInput {
  available: number;
  remaining: number;
  /** 0..∞ ; >1 means overspent */
  usedRatio: number;
  state: "ok" | "warning" | "over";
  /** Spending faster than the month is passing? */
  aheadOfPace: boolean;
}

export function lineStatus(l: LineInput, elapsed: number): LineStatus {
  const available = l.allocated + l.carriedIn;
  const remaining = available - l.spent;
  const usedRatio = available > 0 ? l.spent / available : l.spent > 0 ? Infinity : 0;
  const state = remaining < 0 ? "over" : usedRatio >= 0.85 ? "warning" : "ok";
  // Allow 10% slack so a big weekly shop on day 2 doesn't scream.
  const aheadOfPace = available > 0 && usedRatio > Math.min(1, elapsed + 0.1);
  return { ...l, available, remaining, usedRatio, state, aheadOfPace };
}

export function carryForward(prev: { allocated: number; carriedIn: number; spent: number }, rollover: Rollover): number {
  if (rollover === "none") return 0;
  const left = prev.allocated + prev.carriedIn - prev.spent;
  return rollover === "positive" ? Math.max(0, left) : left;
}

export interface BudgetSummary {
  allocated: number;
  available: number;
  spent: number;
  remaining: number;
  overCount: number;
  /** Zero-based: income still to assign (plannedIncome − allocated). */
  toAssign?: number;
}

export function summarise(lines: LineStatus[], plannedIncome?: number | null): BudgetSummary {
  const allocated = lines.reduce((s, l) => s + l.allocated, 0);
  const available = lines.reduce((s, l) => s + l.available, 0);
  const spent = lines.reduce((s, l) => s + l.spent, 0);
  return {
    allocated,
    available,
    spent,
    remaining: available - spent,
    overCount: lines.filter((l) => l.state === "over").length,
    toAssign: plannedIncome != null ? plannedIncome - allocated : undefined,
  };
}

/** Health score for the dashboard: share of budget lines not over. */
export function budgetHealth(lines: LineStatus[]): number {
  if (!lines.length) return 1;
  return lines.filter((l) => l.state !== "over").length / lines.length;
}
